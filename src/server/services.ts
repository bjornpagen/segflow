import type { MySql2Database } from "drizzle-orm/mysql2"
import * as schema from "../shared/schema"
import type {
	UserOperationResponse,
	CreateSegmentResponse,
	Campaign,
	Event,
	Segment,
	Template,
	UserAttributes,
	DeleteCampaignResponse,
	CreateCampaignResponse,
	Segflow,
	EmailProvider,
	Transaction
} from "../shared/types"

import {
	evaluateSegmentForAllUsers,
	evaluateUserSegmentsAfterEvent,
	evaluateUserSegments,
	evaluateUserCampaigns,
	reevaluateCampaignsForSegmentChange,
	checkSegmentDeletionConstraints,
	createExecution,
	killExecution,
	extractEventTriggersFromSQL,
	sendTransactionEmail,
	reevaluateUserMembershipsAfterAttributeChange
} from "./evaluators"

import { eq, inArray, sql } from "drizzle-orm"
import { analyzeConfig, executeConfigDelta } from "./config"

export async function createUser(
	db: MySql2Database<typeof schema>,
	id: string,
	attributes: UserAttributes
): Promise<UserOperationResponse> {
	let updates

	await db.transaction(async (tx) => {
		await tx.insert(schema.users).values({ id, attributes })
		updates = await reevaluateUserMembershipsAfterAttributeChange(
			tx,
			id,
			"initial user evaluation"
		)
	})

	return updates!
}

export async function updateUser(
	db: MySql2Database<typeof schema>,
	userId: string,
	attributes: Record<string, any>
): Promise<UserOperationResponse> {
	let updates

	await db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(schema.users)
			.where(eq(schema.users.id, userId))
			.limit(1)

		if (!existing[0]) {
			throw new Error("user not found")
		}

		await tx
			.update(schema.users)
			.set({ attributes: { ...existing[0].attributes, ...attributes } })
			.where(eq(schema.users.id, userId))

		updates = await reevaluateUserMembershipsAfterAttributeChange(
			tx,
			userId,
			"User was updated and no longer matches campaign criteria"
		)
	})

	return updates!
}

export async function getUser<T extends Record<string, any>>(
	db: MySql2Database<typeof schema>,
	userId: string
): Promise<UserAttributes<T>> {
	const user = await db
		.select({ attributes: schema.users.attributes })
		.from(schema.users)
		.where(eq(schema.users.id, userId))
		.limit(1)

	if (!user[0]) {
		throw new Error("User not found: " + userId)
	}

	return user[0].attributes
}

export async function deleteUser(
	db: MySql2Database<typeof schema>,
	userId: string
): Promise<void> {
	await db.delete(schema.users).where(eq(schema.users.id, userId))
}

export async function createEvent(
	db: MySql2Database<typeof schema>,
	userId: string,
	name: string,
	attributes: Record<string, any>
): Promise<UserOperationResponse> {
	let updates
	let eventId!: number

	await db.transaction(async (tx) => {
		// Insert the event and get its ID
		const result = await tx
			.insert(schema.events)
			.values({
				userId,
				name,
				attributes,
				createdAt: new Date()
			})
			.$returningId()
		eventId = result[0].id

		updates = await reevaluateUserMembershipsAfterAttributeChange(
			tx,
			userId,
			`user removed due to event: ${name}`,
			{ event: { name } }
		)
	})

	// Send transaction email independently after the main transaction completes
	try {
		const matchingTransaction = await db
			.select()
			.from(schema.transactions)
			.where(eq(schema.transactions.event, name))
			.limit(1)
			.then((rows) => rows[0])

		if (matchingTransaction) {
			await sendTransactionEmail(db, matchingTransaction.id, eventId)
		}
	} catch (error) {
		console.error("Failed to send transaction email:", error)
	}

	return updates!
}

export async function getUserEvents(
	db: MySql2Database<typeof schema>,
	userId: string
): Promise<Omit<Event, "userId">[]> {
	return db
		.select({
			name: schema.events.name,
			createdAt: schema.events.createdAt,
			attributes: schema.events.attributes
		})
		.from(schema.events)
		.where(eq(schema.events.userId, userId))
}

export async function createSegment(
	db: MySql2Database<typeof schema>,
	segmentId: string,
	evaluator: string
): Promise<CreateSegmentResponse> {
	const eventTriggers = extractEventTriggersFromSQL(evaluator)
	let segmentStats
	let campaignUpdates

	await db.transaction(async (tx) => {
		await tx.insert(schema.segments).values({
			id: segmentId,
			evaluator
		})

		if (eventTriggers.length > 0) {
			await tx.insert(schema.segmentEventTriggers).values(
				eventTriggers.map((event) => ({
					segmentId,
					event
				}))
			)
		}

		segmentStats = await evaluateSegmentForAllUsers(tx, segmentId)
		campaignUpdates = await reevaluateCampaignsForSegmentChange(
			tx,
			segmentId,
			segmentStats
		)

		for (const change of campaignUpdates.campaignChanges) {
			if (change.type === "added") {
				await createExecution(tx, change.userId, change.campaignId)
			} else {
				const campaign = await tx
					.select()
					.from(schema.campaigns)
					.where(eq(schema.campaigns.id, change.campaignId))
					.limit(1)

				if (campaign[0]?.behavior !== "static") {
					await killExecution(
						tx,
						change.userId,
						change.campaignId,
						"user removed from segment: " + segmentId
					)
				}
			}
		}
	})

	return {
		eventTriggers,
		stats: segmentStats!,
		campaignUpdates: campaignUpdates!.campaignChanges
	}
}

export async function getSegments(
	db: MySql2Database<typeof schema>
): Promise<Segment[]> {
	return db.select().from(schema.segments)
}

export async function getUserSegments(
	db: MySql2Database<typeof schema>,
	userId: string
): Promise<string[]> {
	const segments = await db
		.select({
			id: schema.segmentUsers.segmentId
		})
		.from(schema.segmentUsers)
		.where(eq(schema.segmentUsers.userId, userId))

	return segments.map((s) => s.id)
}

export async function getSegment(
	db: MySql2Database<typeof schema>,
	segmentId: string
): Promise<Segment> {
	const segment = await db
		.select({
			evaluator: schema.segments.evaluator
		})
		.from(schema.segments)
		.where(eq(schema.segments.id, segmentId))
		.limit(1)

	if (!segment[0]) {
		throw new Error("Segment not found: " + segmentId)
	}

	return segment[0]
}

export async function deleteSegment(
	db: MySql2Database<typeof schema>,
	segmentId: string
): Promise<void> {
	await db.transaction(async (tx) => {
		const referencingCampaigns = await checkSegmentDeletionConstraints(
			tx,
			segmentId
		)
		if (referencingCampaigns && referencingCampaigns.length > 0) {
			throw new Error(
				"cannot delete segment '" +
					segmentId +
					"' because it is referenced by campaigns: " +
					referencingCampaigns.map((c) => c.campaignId).join(", ")
			)
		}

		await tx.delete(schema.segments).where(eq(schema.segments.id, segmentId))
	})
}

export async function updateSegment(
	db: MySql2Database<typeof schema>,
	segmentId: string,
	evaluator: string
): Promise<CreateSegmentResponse> {
	const eventTriggers = extractEventTriggersFromSQL(evaluator)
	let segmentStats
	let campaignUpdates

	await db.transaction(async (tx) => {
		await tx
			.update(schema.segments)
			.set({ evaluator })
			.where(eq(schema.segments.id, segmentId))

		await tx
			.delete(schema.segmentEventTriggers)
			.where(eq(schema.segmentEventTriggers.segmentId, segmentId))

		if (eventTriggers.length > 0) {
			await tx.insert(schema.segmentEventTriggers).values(
				eventTriggers.map((event) => ({
					segmentId,
					event
				}))
			)
		}

		segmentStats = await evaluateSegmentForAllUsers(tx, segmentId)
		campaignUpdates = await reevaluateCampaignsForSegmentChange(
			tx,
			segmentId,
			segmentStats
		)

		for (const change of campaignUpdates.campaignChanges) {
			if (change.type === "added") {
				await createExecution(tx, change.userId, change.campaignId)
			} else {
				const campaign = await tx
					.select()
					.from(schema.campaigns)
					.where(eq(schema.campaigns.id, change.campaignId))
					.limit(1)

				if (campaign[0]?.behavior !== "static") {
					await killExecution(
						tx,
						change.userId,
						change.campaignId,
						"user removed from segment: " + segmentId
					)
				}
			}
		}
	})

	return {
		eventTriggers,
		stats: segmentStats!,
		campaignUpdates: campaignUpdates!.campaignChanges
	}
}

export async function getSegmentUsers(
	db: MySql2Database<typeof schema>,
	segmentId: string
): Promise<string[]> {
	const users = await db
		.select({ userId: schema.segmentUsers.userId })
		.from(schema.segmentUsers)
		.where(eq(schema.segmentUsers.segmentId, segmentId))

	return users.map((u) => u.userId)
}

export async function createTemplate(
	db: MySql2Database<typeof schema>,
	id: string,
	subject: string,
	html: string,
	preamble: string
): Promise<void> {
	await db.insert(schema.templates).values({
		id,
		subject,
		html,
		preamble
	})
}

export async function getTemplate(
	db: MySql2Database<typeof schema>,
	id: string
): Promise<Template> {
	const template = await db
		.select({
			subject: schema.templates.subject,
			html: schema.templates.html,
			preamble: schema.templates.preamble
		})
		.from(schema.templates)
		.where(eq(schema.templates.id, id))
		.limit(1)

	if (!template[0]) {
		throw new Error("template not found: " + id)
	}

	return template[0]
}

export async function getCampaign(
	db: MySql2Database<typeof schema>,
	campaignId: string
): Promise<Campaign> {
	const campaign = await db
		.select()
		.from(schema.campaigns)
		.where(eq(schema.campaigns.id, campaignId))
		.limit(1)

	if (!campaign[0]) {
		throw new Error("Campaign not found: " + campaignId)
	}

	const campaignSegments = await db
		.select({
			segmentId: schema.campaignSegments.segmentId
		})
		.from(schema.campaignSegments)
		.where(eq(schema.campaignSegments.campaignId, campaignId))

	const excludeSegments = await db
		.select({
			segmentId: schema.campaignExcludeSegments.segmentId
		})
		.from(schema.campaignExcludeSegments)
		.where(eq(schema.campaignExcludeSegments.campaignId, campaignId))

	return {
		...campaign[0],
		segments: campaignSegments.map((s) => s.segmentId),
		excludeSegments: excludeSegments.map((s) => s.segmentId)
	}
}

export async function deleteTemplate(
	db: MySql2Database<typeof schema>,
	id: string
): Promise<void> {
	await db.delete(schema.templates).where(eq(schema.templates.id, id))
}

export async function updateTemplate(
	db: MySql2Database<typeof schema>,
	id: string,
	subject: string,
	html: string,
	preamble: string
): Promise<void> {
	const template = await db
		.select()
		.from(schema.templates)
		.where(eq(schema.templates.id, id))
		.limit(1)

	if (!template[0]) {
		throw new Error("template not found")
	}

	await db
		.update(schema.templates)
		.set({ subject, html, preamble })
		.where(eq(schema.templates.id, id))
}

export async function createConfig(
	db: MySql2Database<typeof schema>,
	config: Segflow
): Promise<number | undefined> {
	let newConfigId: number | undefined
	let noChanges = false

	await db.transaction(async (tx) => {
		const delta = await analyzeConfig(tx, config)
		if (
			delta.templateOperations.length === 0 &&
			delta.segmentOperations.length === 0 &&
			delta.campaignOperations.length === 0 &&
			delta.transactionOperations.length === 0 &&
			delta.emailProviderOperations.length === 0
		) {
			noChanges = true
			return
		}

		await executeConfigDelta(tx, delta)
		const result = await tx
			.insert(schema.configs)
			.values({
				configJson: config
			})
			.$returningId()
		newConfigId = result[0].id
	})
	if (!newConfigId && !noChanges) {
		throw new Error("new config id not found")
	}

	return noChanges ? undefined : newConfigId
}

export async function createCampaign(
	db: MySql2Database<typeof schema>,
	id: string,
	flow: string,
	behavior: "static" | "dynamic",
	segments: string[],
	excludeSegments?: string[]
): Promise<CreateCampaignResponse> {
	// Insert campaign
	await db.insert(schema.campaigns).values({
		id,
		flow,
		behavior
	})

	// Create segment relationships
	for (const segmentId of segments) {
		await db.insert(schema.campaignSegments).values({
			campaignId: id,
			segmentId
		})
	}

	if (excludeSegments) {
		for (const segmentId of excludeSegments) {
			await db.insert(schema.campaignExcludeSegments).values({
				campaignId: id,
				segmentId
			})
		}
	}

	// First get users who have ALL required segments
	const usersWithAllSegments = await db
		.selectDistinct({
			userId: schema.segmentUsers.userId
		})
		.from(schema.segmentUsers)
		.where(inArray(schema.segmentUsers.segmentId, segments))
		.groupBy(schema.segmentUsers.userId)
		.having(
			sql`COUNT(DISTINCT ${schema.segmentUsers.segmentId}) = ${segments.length}`
		)

	let excludeUserIds: string[] = []
	if (excludeSegments) {
		// Otherwise, filter out users who have ANY exclude segments
		const usersWithExcludeSegments = await db
			.selectDistinct({
				userId: schema.segmentUsers.userId
			})
			.from(schema.segmentUsers)
			.where(inArray(schema.segmentUsers.segmentId, excludeSegments))

		excludeUserIds = usersWithExcludeSegments.map((u) => u.userId)
	}

	// Final filtered list
	const includedUsers = usersWithAllSegments.filter(
		(user) => !excludeUserIds.includes(user.userId)
	)

	// Add initial campaign memberships
	if (includedUsers.length > 0) {
		await db.insert(schema.campaignUsers).values(
			includedUsers.map((user) => ({
				userId: user.userId,
				campaignId: id
			}))
		)

		// Create execution states for each new user
		for (const user of includedUsers) {
			await createExecution(db, user.userId, id)
		}
	}

	return {
		initialMemberCount: includedUsers.length
	}
}

export async function deleteCampaign(
	db: MySql2Database<typeof schema>,
	campaignId: string
): Promise<DeleteCampaignResponse> {
	const stats = {
		deletedMemberships: 0,
		deletedExecutions: 0
	}

	await db.transaction(async (tx) => {
		// Get all active memberships before deletion
		const memberships = await tx
			.select({
				userId: schema.campaignUsers.userId
			})
			.from(schema.campaignUsers)
			.where(eq(schema.campaignUsers.campaignId, campaignId))

		stats.deletedMemberships = memberships.length

		// Kill any active executions
		const executions = await tx
			.select()
			.from(schema.executions)
			.where(eq(schema.executions.campaignId, campaignId))

		stats.deletedExecutions = executions.length

		for (const execution of executions) {
			await killExecution(tx, execution.userId, campaignId, "Campaign deleted")
		}

		// Delete the campaign (this will cascade to all related tables)
		await tx.delete(schema.campaigns).where(eq(schema.campaigns.id, campaignId))
	})

	return stats
}

export async function getCampaigns(
	db: MySql2Database<typeof schema>
): Promise<Campaign[]> {
	const campaigns = await db
		.select({
			id: schema.campaigns.id,
			behavior: schema.campaigns.behavior,
			flow: schema.campaigns.flow
		})
		.from(schema.campaigns)

	return Promise.all(
		campaigns.map(async (campaign) => {
			const segments = await db
				.select({
					segmentId: schema.campaignSegments.segmentId
				})
				.from(schema.campaignSegments)
				.where(eq(schema.campaignSegments.campaignId, campaign.id))

			const excludeSegments = await db
				.select({
					segmentId: schema.campaignExcludeSegments.segmentId
				})
				.from(schema.campaignExcludeSegments)
				.where(eq(schema.campaignExcludeSegments.campaignId, campaign.id))

			return {
				...campaign,
				segments: segments.map((s) => s.segmentId),
				excludeSegments: excludeSegments.map((s) => s.segmentId)
			}
		})
	)
}

export async function setEmailProvider(
	db: MySql2Database<typeof schema>,
	config: EmailProvider
): Promise<void> {
	try {
		await db.transaction(async (tx) => {
			await tx.delete(schema.emailProvider)
			await tx.insert(schema.emailProvider).values({
				id: 1,
				config: config.config,
				fromAddress: config.fromAddress
			})
		})
	} catch (e) {
		throw new Error("error creating email config: " + e)
	}
}

export async function getEmailProvider(
	db: MySql2Database<typeof schema>
): Promise<EmailProvider> {
	const config = await db
		.select({
			config: schema.emailProvider.config,
			fromAddress: schema.emailProvider.fromAddress
		})
		.from(schema.emailProvider)
		.where(eq(schema.emailProvider.id, 1))
		.limit(1)
	if (!config[0]) {
		throw new Error("no email provider configured")
	}

	return config[0]
}

export async function createTransaction(
	db: MySql2Database<typeof schema>,
	id: string,
	event: string,
	subject: string,
	html: string,
	preamble: string
): Promise<void> {
	await db.insert(schema.transactions).values({
		id,
		event,
		subject,
		html,
		preamble
	})
}

export async function updateTransaction(
	db: MySql2Database<typeof schema>,
	id: string,
	event: string,
	subject: string,
	html: string,
	preamble: string
): Promise<void> {
	const transaction = await db
		.select()
		.from(schema.transactions)
		.where(eq(schema.transactions.id, id))
		.limit(1)

	if (!transaction[0]) {
		throw new Error("transaction not found")
	}

	await db
		.update(schema.transactions)
		.set({ event, subject, html, preamble })
		.where(eq(schema.transactions.id, id))
}

export async function deleteTransaction(
	db: MySql2Database<typeof schema>,
	id: string
): Promise<void> {
	await db.delete(schema.transactions).where(eq(schema.transactions.id, id))
}

export async function getTransaction(
	db: MySql2Database<typeof schema>,
	id: string
): Promise<Transaction> {
	const transaction = await db
		.select({
			event: schema.transactions.event,
			subject: schema.transactions.subject,
			html: schema.transactions.html,
			preamble: schema.transactions.preamble
		})
		.from(schema.transactions)
		.where(eq(schema.transactions.id, id))
		.limit(1)

	if (!transaction[0]) {
		throw new Error("transaction not found: " + id)
	}

	return transaction[0]
}
