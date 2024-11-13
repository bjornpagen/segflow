import type { MySql2Database } from "drizzle-orm/mysql2"
import * as schema from "../shared/schema"
import type {
	EmailProvider,
	Segflow,
	Segment,
	Template,
	Transaction,
	Campaign
} from "../shared/types"
import { desc, isNotNull } from "drizzle-orm"
import {
	createTemplate,
	updateTemplate,
	deleteTemplate,
	createSegment,
	updateSegment,
	deleteSegment,
	createCampaign,
	deleteCampaign,
	setEmailProvider,
	createTransaction,
	updateTransaction,
	deleteTransaction
} from "./services"

type TemplateOperation =
	| {
			type: "add"
			id: string
			data: Template
	  }
	| {
			type: "update"
			id: string
			data: Template
	  }
	| { type: "delete"; id: string }

type SegmentOperation =
	| { type: "add"; id: string; data: Segment }
	| { type: "update"; id: string; data: Segment }
	| { type: "delete"; id: string }

type CampaignOperation =
	| {
			type: "add"
			id: string
			data: Campaign
	  }
	| {
			type: "update"
			id: string
			data: Campaign
	  }
	| { type: "delete"; id: string }

type EmailProviderOperation = { type: "update"; data: EmailProvider }

// Add new type for transaction operations
type TransactionOperation =
	| {
			type: "add"
			id: string
			data: Transaction
	  }
	| {
			type: "update"
			id: string
			data: Transaction
	  }
	| { type: "delete"; id: string }

export interface ConfigDelta {
	templateOperations: TemplateOperation[]
	segmentOperations: SegmentOperation[]
	campaignOperations: CampaignOperation[]
	transactionOperations: TransactionOperation[]
	emailProviderOperations: EmailProviderOperation[]
}

export async function analyzeConfig(
	tx: MySql2Database<typeof schema>,
	newConfig: Segflow
): Promise<ConfigDelta> {
	// Fetch the last accepted config from the database
	const lastConfigResult = await tx
		.select({
			id: schema.configs.id,
			configJson: schema.configs.configJson
		})
		.from(schema.configs)
		.where(isNotNull(schema.configs.createdAt))
		.orderBy(desc(schema.configs.createdAt))
		.limit(1)

	const lastConfig = lastConfigResult[0]?.configJson as Segflow | undefined

	// Compute operations
	const templateOperations = computeTemplateOperations(
		lastConfig?.templates || {},
		newConfig.templates
	)

	const segmentOperations = computeSegmentOperations(
		lastConfig?.segments || {},
		newConfig.segments
	)

	const campaignOperations = computeCampaignOperations(
		lastConfig?.campaigns || {},
		newConfig.campaigns
	)

	const transactionOperations = computeTransactionOperations(
		lastConfig?.transactions || {},
		newConfig.transactions
	)

	const emailProviderOperations = computeEmailProviderOperations(
		lastConfig?.emailProvider,
		newConfig.emailProvider
	)

	// Return the computed delta
	return {
		templateOperations,
		segmentOperations,
		campaignOperations,
		transactionOperations,
		emailProviderOperations
	}
}

// Function to compute template operations
function computeTemplateOperations(
	oldTemplates: Record<string, Template>,
	newTemplates: Record<string, Template>
): TemplateOperation[] {
	const operations: TemplateOperation[] = []
	const oldIds = new Set(Object.keys(oldTemplates))
	const newIds = new Set(Object.keys(newTemplates))

	// Identify deleted templates
	for (const id of oldIds) {
		if (!newIds.has(id)) {
			operations.push({ type: "delete", id })
		}
	}

	// Identify added or updated templates
	for (const id of newIds) {
		if (!oldIds.has(id)) {
			operations.push({ type: "add", id, data: newTemplates[id] })
		} else {
			const oldTemplate = oldTemplates[id]
			const newTemplate = newTemplates[id]
			if (
				oldTemplate.subject !== newTemplate.subject ||
				oldTemplate.html !== newTemplate.html ||
				oldTemplate.preamble !== newTemplate.preamble
			) {
				operations.push({ type: "update", id, data: newTemplate })
			}
		}
	}

	return operations
}

// Function to compute segment operations
function computeSegmentOperations(
	oldSegments: Record<string, Segment>,
	newSegments: Record<string, Segment>
): SegmentOperation[] {
	const operations: SegmentOperation[] = []
	const oldIds = new Set(Object.keys(oldSegments))
	const newIds = new Set(Object.keys(newSegments))

	// Identify deleted segments
	for (const id of oldIds) {
		if (!newIds.has(id)) {
			operations.push({ type: "delete", id })
		}
	}

	// Identify added or updated segments
	for (const id of newIds) {
		if (!oldIds.has(id)) {
			operations.push({ type: "add", id, data: newSegments[id] })
		} else {
			const oldSegment = oldSegments[id]
			const newSegment = newSegments[id]
			if (oldSegment.evaluator !== newSegment.evaluator) {
				operations.push({ type: "update", id, data: newSegment })
			}
		}
	}

	return operations
}

// Function to compute campaign operations
function computeCampaignOperations(
	oldCampaigns: Record<
		string,
		{
			flow: string
			behavior: "static" | "dynamic"
			segments: string[]
			excludeSegments?: string[]
		}
	>,
	newCampaigns: Record<
		string,
		{
			flow: string
			behavior: "static" | "dynamic"
			segments: string[]
			excludeSegments?: string[]
		}
	>
): CampaignOperation[] {
	const operations: CampaignOperation[] = []
	const oldIds = new Set(Object.keys(oldCampaigns))
	const newIds = new Set(Object.keys(newCampaigns))

	// Identify deleted campaigns
	for (const id of oldIds) {
		if (!newIds.has(id)) {
			operations.push({ type: "delete", id })
		}
	}

	// Identify added or updated campaigns
	for (const id of newIds) {
		if (!oldIds.has(id)) {
			operations.push({ type: "add", id, data: newCampaigns[id] })
		} else {
			const oldCampaign = oldCampaigns[id]
			const newCampaign = newCampaigns[id]
			if (
				oldCampaign.flow !== newCampaign.flow ||
				oldCampaign.behavior !== newCampaign.behavior ||
				JSON.stringify(oldCampaign.segments.sort()) !==
					JSON.stringify(newCampaign.segments.sort()) ||
				JSON.stringify(oldCampaign.excludeSegments?.sort() || []) !==
					JSON.stringify(newCampaign.excludeSegments?.sort() || [])
			) {
				operations.push({ type: "update", id, data: newCampaign })
			}
		}
	}

	return operations
}

function computeEmailProviderOperations(
	oldProvider: EmailProvider | undefined,
	newProvider: EmailProvider
): EmailProviderOperation[] {
	if (
		!oldProvider ||
		JSON.stringify(oldProvider) !== JSON.stringify(newProvider)
	) {
		return [{ type: "update", data: newProvider }]
	}
	return []
}

// Add function to compute transaction operations
function computeTransactionOperations(
	oldTransactions: Record<string, Transaction>,
	newTransactions: Record<string, Transaction>
): TransactionOperation[] {
	const operations: TransactionOperation[] = []
	const oldIds = new Set(Object.keys(oldTransactions))
	const newIds = new Set(Object.keys(newTransactions))

	// Identify deleted transactions
	for (const id of oldIds) {
		if (!newIds.has(id)) {
			operations.push({ type: "delete", id })
		}
	}

	// Identify added or updated transactions
	for (const id of newIds) {
		if (!oldIds.has(id)) {
			operations.push({
				type: "add",
				id,
				data: newTransactions[id]
			})
		} else {
			const oldTransaction = oldTransactions[id]
			const newTransaction = newTransactions[id]
			if (
				oldTransaction.event !== newTransaction.event ||
				oldTransaction.subject !== newTransaction.subject ||
				oldTransaction.html !== newTransaction.html ||
				oldTransaction.preamble !== newTransaction.preamble
			) {
				operations.push({
					type: "update",
					id,
					data: newTransaction
				})
			}
		}
	}

	return operations
}

/**
 * Executes the configuration delta in the correct order:
 * 1. Templates (they have no dependencies)
 * 2. Segments (they may reference templates)
 * 3. Campaigns (they depend on segments)
 * 4. Email provider (they depend on campaigns)
 */
export async function executeConfigDelta(
	db: MySql2Database<typeof schema>,
	delta: ConfigDelta
): Promise<void> {
	// Execute template operations first
	for (const op of delta.templateOperations) {
		switch (op.type) {
			case "add":
				await createTemplate(
					db,
					op.id,
					op.data.subject,
					op.data.html,
					op.data.preamble
				)
				break
			case "update":
				await updateTemplate(
					db,
					op.id,
					op.data.subject,
					op.data.html,
					op.data.preamble
				)
				break
			case "delete":
				await deleteTemplate(db, op.id)
				break
		}
	}

	// Execute transaction operations second (they're independent like templates)
	for (const op of delta.transactionOperations) {
		switch (op.type) {
			case "add":
				await createTransaction(
					db,
					op.id,
					op.data.event,
					op.data.subject,
					op.data.html,
					op.data.preamble
				)
				break
			case "update":
				await updateTransaction(
					db,
					op.id,
					op.data.event,
					op.data.subject,
					op.data.html,
					op.data.preamble
				)
				break
			case "delete":
				await deleteTransaction(db, op.id)
				break
		}
	}

	// Execute segment operations second
	for (const op of delta.segmentOperations) {
		switch (op.type) {
			case "add":
				await createSegment(db, op.id, op.data.evaluator)
				break
			case "update":
				await updateSegment(db, op.id, op.data.evaluator)
				break
			case "delete":
				await deleteSegment(db, op.id)
				break
		}
	}

	// Execute campaign operations last
	for (const op of delta.campaignOperations) {
		switch (op.type) {
			case "add":
				await createCampaign(
					db,
					op.id,
					op.data.flow,
					op.data.behavior,
					op.data.segments,
					op.data.excludeSegments
				)
				break
			case "update":
				// For updates, we delete and recreate since campaigns can have complex relationships
				// await deleteCampaign(db, op.id);
				// await createCampaign(
				//   db,
				//   op.id,
				//   op.data.flow,
				//   op.data.behavior,
				//   op.data.segments,
				//   op.data.excludeSegments
				// );

				// No, we don't support this right now. Don't let users update campaigns.
				throw new Error(
					`campaign updates are not supported: tried to update '${op.id}'`
				)
			case "delete":
				await deleteCampaign(db, op.id)
				break
		}
	}

	// Execute email provider operations last
	for (const op of delta.emailProviderOperations) {
		if (op.type === "update") {
			await setEmailProvider(db, op.data)
		}
	}
}
