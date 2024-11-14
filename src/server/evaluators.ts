import { eq, and, or, exists, lte, inArray } from "drizzle-orm"
import * as schema from "../shared/schema"
import { sql } from "drizzle-orm"
import type { MySql2Database } from "drizzle-orm/mysql2"
import { Parser } from "node-sql-parser"
import type {
	BaseUserAttributes,
	RuntimeCommand,
	Template,
	User
} from "../shared/types"
import equal from "fast-deep-equal"

import {
	evalSandboxedWithUser,
	evalSandboxedWithUserAndEvent,
	executeGeneratorToIndex,
	renderTemplate,
	renderTransaction
} from "./quickjs"
import { sendEmail } from "./email"

// Update the DB type for MySQL
type DB = MySql2Database<typeof schema>

export async function evaluateSegmentForAllUsers(
	db: DB,
	segmentId: string
): Promise<{
	added: string[]
	removed: string[]
	total: number
}> {
	// Get the segment definition
	const segment = await db
		.select()
		.from(schema.segments)
		.where(eq(schema.segments.id, segmentId))
		.limit(1)

	if (!segment[0]) {
		throw new Error(`Segment ${segmentId} not found`)
	}

	// Get all current memberships for this segment
	const currentMemberships = await db
		.select({
			userId: schema.segmentUsers.userId
		})
		.from(schema.segmentUsers)
		.where(eq(schema.segmentUsers.segmentId, segmentId))

	const currentMemberSet = new Set(currentMemberships.map((m) => m.userId))

	// Execute the segment evaluator to get new matches
	const ret = (await db.execute(segment[0].evaluator))[0] as unknown as {
		id: string
	}[]
	const matches = ret.map((r) => r.id)
	const newMemberSet = new Set(matches)

	// Calculate differences
	const toAdd = [...newMemberSet].filter(
		(userId: unknown): userId is string =>
			typeof userId === "string" && !currentMemberSet.has(userId)
	)
	const toRemove = [...currentMemberSet].filter(
		(userId: unknown): userId is string =>
			typeof userId === "string" && !newMemberSet.has(userId)
	)

	// Add new memberships using INSERT ... SELECT to avoid duplicates
	if (toAdd.length > 0) {
		const query = sql`
    INSERT IGNORE INTO ${schema.segmentUsers} 
    (user_id, segment_id) 
    VALUES 
    ${sql.join(
			toAdd.map((userId) => sql`(${userId}, ${segmentId})`),
			sql`, `
		)}
    `
		await db.execute(query)
	}

	// Remove old memberships
	if (toRemove.length > 0) {
		for (const userId of toRemove) {
			await db
				.delete(schema.segmentUsers)
				.where(
					and(
						eq(schema.segmentUsers.userId, userId),
						eq(schema.segmentUsers.segmentId, segmentId)
					)
				)
		}
	}

	return {
		added: toAdd,
		removed: toRemove,
		total: newMemberSet.size
	}
}

export async function evaluateUserSegments(
	db: DB,
	userId: string
): Promise<{
	added: string[]
	removed: string[]
}> {
	// Get all segments
	const segments = await db.select().from(schema.segments)
	const results: { added: string[]; removed: string[] } = {
		added: [],
		removed: []
	}

	// Get current memberships for this user
	const currentMemberships = await db
		.select()
		.from(schema.segmentUsers)
		.where(eq(schema.segmentUsers.userId, userId))
	const currentSegmentIds = new Set(currentMemberships.map((m) => m.segmentId))

	for (const segment of segments) {
		const userSpecificEvaluator = `
      WITH segment_matches AS (
        ${segment.evaluator}
      )
      SELECT id FROM segment_matches 
      WHERE id = '${userId}'
    `
		const ret = (await db.execute(userSpecificEvaluator))[0] as unknown as {
			id: string
		}[]
		const isMatch = ret.length > 0
		const wasMatch = currentSegmentIds.has(segment.id)

		if (isMatch !== wasMatch) {
			if (isMatch) {
				const query = sql`
        INSERT IGNORE INTO ${schema.segmentUsers} 
        (user_id, segment_id) 
        VALUES 
        (${userId}, ${segment.id})`
				await db.execute(query)
				results.added.push(segment.id)
			} else {
				await db
					.delete(schema.segmentUsers)
					.where(
						and(
							eq(schema.segmentUsers.userId, userId),
							eq(schema.segmentUsers.segmentId, segment.id)
						)
					)
				results.removed.push(segment.id)
			}
		}
	}

	return results
}

/**
 * Evaluates campaign memberships for a user. This function assumes that the user's
 * segment memberships are already up to date.
 *
 * For static campaigns:
 * - User is added if they match conditions
 * - User is never removed once added
 *
 * For dynamic campaigns:
 * - User is added if they match conditions
 * - User is removed if they no longer match conditions
 *
 * @param db Database instance
 * @param userId User to evaluate
 * @returns Array of campaign membership changes
 */
export async function evaluateUserCampaigns(
	db: DB,
	userId: string
): Promise<{
	added: string[]
	removed: string[]
}> {
	// Get all campaigns and their segment relationships
	const campaigns = await db
		.select({
			id: schema.campaigns.id,
			behavior: schema.campaigns.behavior
		})
		.from(schema.campaigns)

	// Get user's current campaign memberships
	const currentMemberships = await db
		.select()
		.from(schema.campaignUsers)
		.where(eq(schema.campaignUsers.userId, userId))

	const currentCampaignIds = new Set(
		currentMemberships.map((m) => m.campaignId)
	)

	// Get user's current segment memberships
	const userSegments = await db
		.select()
		.from(schema.segmentUsers)
		.where(eq(schema.segmentUsers.userId, userId))

	const userSegmentIds = new Set(userSegments.map((s) => s.segmentId))

	const results: { added: string[]; removed: string[] } = {
		added: [],
		removed: []
	}

	for (const campaign of campaigns) {
		// Get include/exclude segments for this campaign
		const includeSegments = await db
			.select()
			.from(schema.campaignSegments)
			.where(eq(schema.campaignSegments.campaignId, campaign.id))

		const excludeSegments = await db
			.select()
			.from(schema.campaignExcludeSegments)
			.where(eq(schema.campaignExcludeSegments.campaignId, campaign.id))

		// Check if user matches campaign conditions
		const matchesInclude = includeSegments.every((s) =>
			userSegmentIds.has(s.segmentId)
		)
		const matchesExclude = excludeSegments.some((s) =>
			userSegmentIds.has(s.segmentId)
		)
		const shouldBeInCampaign = matchesInclude && !matchesExclude

		const isInCampaign = currentCampaignIds.has(campaign.id)

		// For static campaigns, only add users, never remove
		// For dynamic campaigns, both add and remove as needed
		const needsUpdate =
			campaign.behavior === "static"
				? shouldBeInCampaign && !isInCampaign // Only add to static campaigns
				: shouldBeInCampaign !== isInCampaign // Add or remove from dynamic campaigns

		if (needsUpdate) {
			if (shouldBeInCampaign) {
				const query = sql`
          INSERT IGNORE INTO ${schema.campaignUsers} 
          (user_id, campaign_id) 
          VALUES 
          (${userId}, ${campaign.id})`
				await db.execute(query)
				results.added.push(campaign.id)
			} else if (campaign.behavior !== "static") {
				await db
					.delete(schema.campaignUsers)
					.where(
						and(
							eq(schema.campaignUsers.userId, userId),
							eq(schema.campaignUsers.campaignId, campaign.id)
						)
					)
				results.removed.push(campaign.id)
			}
		}
	}

	return results
}

/**
 * Reevaluates all campaigns that depend on a segment after its membership changes
 */
export async function reevaluateCampaignsForSegmentChange(
	db: DB,
	segmentId: string,
	segmentChanges: { added: string[]; removed: string[] }
): Promise<{
	campaignChanges: {
		userId: string
		campaignId: string
		type: "added" | "removed"
	}[]
}> {
	// Find all campaigns that use this segment (either include or exclude)
	const affectedCampaigns = await db
		.select({
			id: schema.campaigns.id,
			behavior: schema.campaigns.behavior
		})
		.from(schema.campaigns)
		.where(
			or(
				exists(
					db
						.select()
						.from(schema.campaignSegments)
						.where(
							and(
								eq(schema.campaignSegments.campaignId, schema.campaigns.id),
								eq(schema.campaignSegments.segmentId, segmentId)
							)
						)
				),
				exists(
					db
						.select()
						.from(schema.campaignExcludeSegments)
						.where(
							and(
								eq(
									schema.campaignExcludeSegments.campaignId,
									schema.campaigns.id
								),
								eq(schema.campaignExcludeSegments.segmentId, segmentId)
							)
						)
				)
			)
		)

	const campaignChanges: {
		userId: string
		campaignId: string
		type: "added" | "removed"
	}[] = []
	const affectedUsers = [
		...new Set([...segmentChanges.added, ...segmentChanges.removed])
	]

	// Only process if there are affected campaigns and users
	if (affectedCampaigns.length > 0 && affectedUsers.length > 0) {
		// Process users in batches to avoid too many concurrent operations
		const BATCH_SIZE = 100
		for (let i = 0; i < affectedUsers.length; i += BATCH_SIZE) {
			const userBatch = affectedUsers.slice(i, i + BATCH_SIZE)

			// Process each user in the batch
			const batchPromises = userBatch.map(async (userId) => {
				const changes = await evaluateUserCampaigns(db, userId)

				return [
					...changes.added.map((campaignId) => ({
						userId,
						campaignId,
						type: "added" as const
					})),
					...changes.removed.map((campaignId) => ({
						userId,
						campaignId,
						type: "removed" as const
					}))
				]
			})

			const batchResults = await Promise.all(batchPromises)
			campaignChanges.push(...batchResults.flat())
		}
	}

	return { campaignChanges }
}

/**
 * Checks if a segment can be safely deleted by checking for campaign references
 * @returns null if segment can be deleted, or details about referencing campaigns if it cannot
 */
export async function checkSegmentDeletionConstraints(
	db: DB,
	segmentId: string
): Promise<
	| {
			campaignId: string
			type: "include" | "exclude"
	  }[]
	| null
> {
	const referencingCampaigns = await db
		.select({
			campaignId: schema.campaigns.id,
			type: sql<"include" | "exclude">`CASE 
      WHEN ${schema.campaignSegments.segmentId} IS NOT NULL THEN 'include'
      ELSE 'exclude'
    END`.as("type")
		})
		.from(schema.campaigns)
		.leftJoin(
			schema.campaignSegments,
			and(
				eq(schema.campaigns.id, schema.campaignSegments.campaignId),
				eq(schema.campaignSegments.segmentId, segmentId)
			)
		)
		.leftJoin(
			schema.campaignExcludeSegments,
			and(
				eq(schema.campaigns.id, schema.campaignExcludeSegments.campaignId),
				eq(schema.campaignExcludeSegments.segmentId, segmentId)
			)
		)
		.where(
			or(
				eq(schema.campaignSegments.segmentId, segmentId),
				eq(schema.campaignExcludeSegments.segmentId, segmentId)
			)
		)

	return referencingCampaigns.length > 0 ? referencingCampaigns : null
}

/**
 * Creates a new execution state for a campaign membership
 */
export async function createExecution(
	db: DB,
	userId: string,
	campaignId: string
) {
	const campaign = await db
		.select()
		.from(schema.campaigns)
		.where(eq(schema.campaigns.id, campaignId))
		.limit(1)
		.then((rows) => rows[0])

	if (!campaign) {
		throw new Error("Campaign not found")
	}

	await db.insert(schema.executions).values({
		userId,
		campaignId,
		status: "pending",
		sleepUntil: new Date()
	})
}

type ExecutionState = {
	userId: string
	campaignId: string
	status: string
	sleepUntil: Date
}

async function setupExecutionState(tx: DB, state: ExecutionState) {
	const campaign = await tx
		.select()
		.from(schema.campaigns)
		.where(eq(schema.campaigns.id, state.campaignId))
		.limit(1)
		.then((rows) => rows[0])

	if (!campaign) {
		throw new Error("Campaign not found")
	}

	const user = await tx
		.select()
		.from(schema.users)
		.where(eq(schema.users.id, state.userId))
		.limit(1)
		.then((rows) => rows[0])

	if (!user) {
		throw new Error("User not found")
	}

	let stepIndex: number
	let attributeStates: (typeof user.attributes)[]

	if (state.status === "pending") {
		stepIndex = 0
		attributeStates = [user.attributes]
	} else if (state.status === "sleeping") {
		const history = await tx
			.select()
			.from(schema.executionHistory)
			.where(
				and(
					eq(schema.executionHistory.userId, state.userId),
					eq(schema.executionHistory.campaignId, state.campaignId)
				)
			)
			.orderBy(schema.executionHistory.stepIndex)

		if (history.length === 0) {
			throw new Error("No execution history found for sleeping state")
		}

		attributeStates = [...history.map((h) => h.attributes), user.attributes]
		stepIndex = history.length
	} else {
		throw new Error("Unknown execution state")
	}

	return { campaign, user, stepIndex, attributeStates }
}

async function handleExecutionCommand(
	tx: DB,
	command: RuntimeCommand,
	state: ExecutionState,
	user: User
) {
	switch (command.type) {
		case "WAIT": {
			console.log("WAIT command received: ", JSON.stringify(command, null, 2))
			const { duration } = command
			const sleepUntil = new Date()

			if (!duration) {
				throw new Error("Wait command missing duration")
			}

			if (duration.seconds)
				sleepUntil.setSeconds(sleepUntil.getSeconds() + duration.seconds)
			if (duration.minutes)
				sleepUntil.setMinutes(sleepUntil.getMinutes() + duration.minutes)
			if (duration.hours)
				sleepUntil.setHours(sleepUntil.getHours() + duration.hours)
			if (duration.days)
				sleepUntil.setDate(sleepUntil.getDate() + duration.days)
			if (duration.weeks)
				sleepUntil.setDate(sleepUntil.getDate() + duration.weeks * 7)

			await tx
				.update(schema.executions)
				.set({
					status: "sleeping",
					sleepUntil
				})
				.where(
					and(
						eq(schema.executions.userId, state.userId),
						eq(schema.executions.campaignId, state.campaignId)
					)
				)
			break
		}
		case "SEND_EMAIL": {
			console.log(
				"SEND_EMAIL command received: ",
				JSON.stringify(command, null, 2)
			)
			await sendTemplateEmail(tx, command.templateId, user.attributes)
			await tx
				.update(schema.executions)
				.set({ status: "sleeping", sleepUntil: new Date() })
				.where(
					and(
						eq(schema.executions.userId, state.userId),
						eq(schema.executions.campaignId, state.campaignId)
					)
				)
			break
		}
		case "SEND_SMS": {
			throw new Error("SMS sending not implemented")
		}
		default:
			throw new Error(`Unknown command type: ${(command as any).type}`)
	}
}

async function processExecution(
	tx: DB,
	state: ExecutionState
): Promise<boolean> {
	try {
		const { campaign, user, stepIndex, attributeStates } =
			await setupExecutionState(tx, state)

		// if the campaign is 'dynamic', we need to check if the user still matches the segment criteria
		if (campaign.behavior === "dynamic" && stepIndex !== 0) {
			const stillMatches = await evaluateUserCampaign(
				tx,
				state.userId,
				campaign.id
			)
			if (!stillMatches) {
				await killExecution(
					tx,
					state.userId,
					campaign.id,
					"User no longer matches campaign criteria"
				)
				return true
			}
		}

		// Record execution state history
		await tx.insert(schema.executionHistory).values({
			userId: state.userId,
			campaignId: state.campaignId,
			stepIndex,
			attributes: user.attributes
		})

		const result = await executeGeneratorToIndex(
			campaign.flow,
			attributeStates,
			stepIndex
		)

		// Handle attribute changes
		if (!equal(result.attributes, user.attributes)) {
			await tx
				.update(schema.users)
				.set({ attributes: result.attributes })
				.where(eq(schema.users.id, state.userId))

			await reevaluateUserMembershipsAfterAttributeChange(
				tx,
				state.userId,
				"user attributes changed and no longer matches campaign criteria"
			)
		}

		if (result.done && !result.value) {
			await tx
				.update(schema.executions)
				.set({ status: "completed" })
				.where(
					and(
						eq(schema.executions.userId, state.userId),
						eq(schema.executions.campaignId, state.campaignId)
					)
				)
			return true
		} else if (!result.value) {
			throw new Error("Generator yielded undefined")
		}

		// Check dynamic campaign criteria again before executing command
		if (campaign.behavior === "dynamic") {
			const stillMatches = await evaluateUserCampaign(
				tx,
				state.userId,
				campaign.id
			)
			if (!stillMatches) {
				await killExecution(
					tx,
					state.userId,
					campaign.id,
					"User no longer matches campaign criteria"
				)
				return true
			}
		}

		await handleExecutionCommand(tx, result.value, state, user)
		return true
	} catch (error) {
		await tx
			.update(schema.executions)
			.set({
				status: "failed",
				error: error instanceof Error ? error.message : "Unknown error"
			})
			.where(
				and(
					eq(schema.executions.userId, state.userId),
					eq(schema.executions.campaignId, state.campaignId)
				)
			)
		return false
	}
}

/**
 * Runs all campaigns that are ready to be executed
 * This would typically be called by a cron job or worker
 */
export async function runExecutions(db: DB) {
	const now = new Date()

	return await db.transaction(async (tx) => {
		// Use SELECT FOR UPDATE to lock the rows we want to process
		const readyStates = await tx
			.select()
			.from(schema.executions)
			.where(
				and(
					inArray(schema.executions.status, [
						"sleeping",
						"pending"
					]),
					lte(schema.executions.sleepUntil, now)
				)
			)
			.for("update")

		// Immediately mark these as running since we have them locked
		if (readyStates.length > 0) {
			await tx
				.update(schema.executions)
				.set({ status: "running" })
				.where(
					or(
						...readyStates.map((state) =>
							and(
								eq(schema.executions.userId, state.userId),
								eq(schema.executions.campaignId, state.campaignId)
							)
						)
					)
				)
		}

		const results = await Promise.all(
			readyStates.map((state) => processExecution(tx, state))
		)

		const succeeded = results.filter(Boolean).length
		return {
			total: readyStates.length,
			succeeded,
			failed: readyStates.length - succeeded
		}
	})
}

async function sendTemplateEmail<T extends BaseUserAttributes>(
	db: DB,
	templateId: string,
	user: T
) {
	const to = user.email

	let template: Template
	try {
		template = await db
			.select()
			.from(schema.templates)
			.where(eq(schema.templates.id, templateId))
			.limit(1)
			.then((rows) => rows[0])
	} catch (e) {
		throw new Error(`db error: ${e}`)
	}

	if (!template) {
		throw new Error(`template not found: ${templateId}`)
	}

	const processedSubject = await evalSandboxedWithUser(template.subject, user)
	const processedHtml = await renderTemplate(
		template.html,
		template.preamble,
		user
	)

	return sendEmail(db, to, processedSubject, processedHtml)
}

/**
 * Internal function to pause execution and schedule a resume
 */
export async function sleepExecution(
	db: DB,
	userId: string,
	campaignId: string,
	sleepUntil: Date
) {
	await db
		.update(schema.executions)
		.set({
			status: "sleeping",
			sleepUntil
		})
		.where(
			and(
				eq(schema.executions.userId, userId),
				eq(schema.executions.campaignId, campaignId)
			)
		)
}

/**
 * Kills execution state for a campaign membership
 * Used when a user leaves a campaign or when cleaning up dynamic campaigns
 */
export async function killExecution(
	db: DB,
	userId: string,
	campaignId: string,
	error = "Campaign membership ended"
) {
	const state = await db
		.select()
		.from(schema.executions)
		.where(
			and(
				eq(schema.executions.userId, userId),
				eq(schema.executions.campaignId, campaignId)
			)
		)
		.limit(1)
		.then((rows) => rows[0])

	if (!state) {
		return // Already cleaned up or never existed
	}

	await db
		.update(schema.executions)
		.set({
			status: "terminated",
			error
		})
		.where(
			and(
				eq(schema.executions.userId, userId),
				eq(schema.executions.campaignId, campaignId)
			)
		)
}

export async function evaluateUserSegmentsAfterEvent(
	db: DB,
	userId: string,
	eventName: string
): Promise<{
	added: string[]
	removed: string[]
}> {
	const triggeredSegments = await db
		.select({
			segmentId: schema.segmentEventTriggers.segmentId
		})
		.from(schema.segmentEventTriggers)
		.where(eq(schema.segmentEventTriggers.event, eventName))

	const results: { added: string[]; removed: string[] } = {
		added: [],
		removed: []
	}

	for (const { segmentId } of triggeredSegments) {
		const segment = await db
			.select()
			.from(schema.segments)
			.where(eq(schema.segments.id, segmentId))
			.limit(1)

		if (!segment[0]) continue

		const currentMembership = await db
			.select()
			.from(schema.segmentUsers)
			.where(
				and(
					eq(schema.segmentUsers.userId, userId),
					eq(schema.segmentUsers.segmentId, segmentId)
				)
			)
			.limit(1)

		const wasMatch = Boolean(currentMembership[0])

		const userSpecificEvaluator = `
      WITH segment_matches AS (
        ${segment[0].evaluator}
      )
      SELECT id FROM segment_matches 
      WHERE id = '${userId}'  
    `
		const ret = (await db.execute(userSpecificEvaluator))[0] as unknown as {
			id: string
		}[]
		const matches = ret.map((r) => r.id)
		const isMatch = matches.length > 0

		if (isMatch !== wasMatch) {
			if (isMatch) {
				const query = sql`
        INSERT IGNORE INTO ${schema.segmentUsers} 
        (user_id, segment_id) 
        VALUES 
        (${userId}, ${segmentId})`
				await db.execute(query)
				results.added.push(segmentId)
			} else {
				await db
					.delete(schema.segmentUsers)
					.where(
						and(
							eq(schema.segmentUsers.userId, userId),
							eq(schema.segmentUsers.segmentId, segmentId)
						)
					)
				results.removed.push(segmentId)
			}
		}
	}

	return results
}

export function extractEventTriggersFromSQL(sql: string): string[] {
	const unquotedSQL = sql.replace(/`([^`]+)`/g, "$1")
	const parser = new Parser()
	const ast = parser.astify(unquotedSQL, { database: "mysql" })

	const eventTriggers = new Set<string>()

	function traverseAST(node: any) {
		if (!node) return

		// Handle IN expressions
		if (node.type === "binary_expr" && node.operator.toLowerCase() === "in") {
			const { left, right } = node

			// Check if we're comparing events.name
			if (
				left?.type === "column_ref" &&
				left.table === "events" &&
				left.column === "name"
			) {
				// Extract values from the IN list
				if (Array.isArray(right.value)) {
					right.value.forEach((item: any) => {
						if (item.type === "single_quote_string" || item.type === "string") {
							eventTriggers.add(item.value)
						}
					})
				}
			}
		}

		// Handle simple equality comparisons
		if (node.type === "binary_expr" && ["=", "=="].includes(node.operator)) {
			const { left, right } = node

			// Check events.name = 'value'
			if (
				left?.type === "column_ref" &&
				left.table === "events" &&
				left.column === "name" &&
				(right?.type === "single_quote_string" || right?.type === "string")
			) {
				eventTriggers.add(right.value)
			}
			// Check 'value' = events.name
			if (
				right?.type === "column_ref" &&
				right.table === "events" &&
				right.column === "name" &&
				(left?.type === "single_quote_string" || left?.type === "string")
			) {
				eventTriggers.add(left.value)
			}
		}

		// Recursively traverse all properties
		if (typeof node === "object") {
			Object.values(node).forEach((value) => {
				if (Array.isArray(value)) {
					value.forEach((item) => traverseAST(item))
				} else if (typeof value === "object") {
					traverseAST(value)
				}
			})
		}
	}

	traverseAST(ast)
	return [...eventTriggers]
}

/**
 * Evaluates if a user matches a specific campaign's criteria
 * Returns true if user should be in campaign, false otherwise
 */
async function evaluateUserCampaign(
	db: DB,
	userId: string,
	campaignId: string
): Promise<boolean> {
	// Get user's current segment memberships
	const userSegments = await db
		.select()
		.from(schema.segmentUsers)
		.where(eq(schema.segmentUsers.userId, userId))

	const userSegmentIds = new Set(userSegments.map((s) => s.segmentId))

	// Get include/exclude segments for this campaign
	const includeSegments = await db
		.select()
		.from(schema.campaignSegments)
		.where(eq(schema.campaignSegments.campaignId, campaignId))

	const excludeSegments = await db
		.select()
		.from(schema.campaignExcludeSegments)
		.where(eq(schema.campaignExcludeSegments.campaignId, campaignId))

	// User must be in ALL required segments
	const matchesInclude = includeSegments.every((s) =>
		userSegmentIds.has(s.segmentId)
	)
	// User must NOT be in ANY excluded segments
	const matchesExclude = excludeSegments.some((s) =>
		userSegmentIds.has(s.segmentId)
	)

	return matchesInclude && !matchesExclude
}

/**
 * Sends a transactional email based on an event
 * @param db Database connection
 * @param transactionId ID of the transaction template to use
 * @param eventId ID of the event that triggered the transaction
 */
export async function sendTransactionEmail(
	db: DB,
	transactionId: string,
	eventId: number
): Promise<void> {
	// Get the event record
	const event = await db
		.select()
		.from(schema.events)
		.where(eq(schema.events.id, eventId))
		.limit(1)
		.then((rows) => rows[0])

	if (!event) {
		throw new Error(`Event not found: ${eventId}`)
	}

	// Get the transaction template
	const transaction = await db
		.select()
		.from(schema.transactions)
		.where(eq(schema.transactions.id, transactionId))
		.limit(1)
		.then((rows) => rows[0])

	if (!transaction) {
		throw new Error(`Transaction not found: ${transactionId}`)
	}

	// Verify the event matches the transaction
	if (transaction.event !== event.name) {
		throw new Error(
			`event ${event.name} does not match transaction ${transactionId} (expected ${transaction.event})`
		)
	}

	// Get the user's attributes
	const user = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.id, event.userId))
		.limit(1)
		.then((rows) => rows[0])

	if (!user) {
		throw new Error(`user not found: ${event.userId}`)
	}

	// Process the subject template with both user and event data
	const processedSubject = await evalSandboxedWithUserAndEvent(
		transaction.subject,
		user.attributes,
		event.attributes
	)

	// Render the HTML template with both user and event data
	const processedHtml = await renderTransaction(
		transaction.html,
		transaction.preamble,
		user.attributes,
		event.attributes
	)

	// Send the email
	try {
		await sendEmail(db, user.attributes.email, processedSubject, processedHtml)
	} catch (e) {
		console.log(`executed transaction: failed: ${e}`)
		throw e
	}
	console.log(`executed transaction: success`)
}

/**
 * Reevaluates a user's segment and campaign memberships after their attributes change.
 * Handles creating new campaign executions and killing existing ones as needed.
 */
export async function reevaluateUserMembershipsAfterAttributeChange(
	db: DB,
	userId: string,
	reason: string,
	options?: {
		event?: { name: string }
	}
): Promise<{
	segmentUpdates: { added: string[]; removed: string[] }
	campaignUpdates: { added: string[]; removed: string[] }
}> {
	let segmentUpdates
	if (options?.event) {
		segmentUpdates = await evaluateUserSegmentsAfterEvent(
			db,
			userId,
			options.event.name
		)
	} else {
		segmentUpdates = await evaluateUserSegments(db, userId)
	}

	const campaignUpdates = await evaluateUserCampaigns(db, userId)

	// Handle new campaign memberships
	for (const campaignId of campaignUpdates.added) {
		await createExecution(db, userId, campaignId)
	}

	// Get all non-static campaigns from the removed set
	const dynamicCampaigns = await db
		.select({ id: schema.campaigns.id })
		.from(schema.campaigns)
		.where(
			and(
				inArray(schema.campaigns.id, campaignUpdates.removed),
				eq(schema.campaigns.behavior, "dynamic")
			)
		)

	// Kill executions for dynamic campaigns only
	for (const campaign of dynamicCampaigns) {
		await killExecution(db, userId, campaign.id, reason)
	}

	return { segmentUpdates, campaignUpdates }
}
