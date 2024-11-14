import {
	mysqlTable,
	varchar,
	int,
	primaryKey,
	json,
	timestamp,
	foreignKey,
	text
} from "drizzle-orm/mysql-core"
import type { UserAttributes, Segflow, EmailProviderConfig } from "./types"

const VARCHAR_LENGTH = 255

export const users = mysqlTable("users", {
	id: varchar("id", { length: VARCHAR_LENGTH }).primaryKey(),
	attributes: json("attributes").$type<UserAttributes<any>>().notNull()
})

export const events = mysqlTable("events", {
	id: int("id").autoincrement().primaryKey(),
	name: varchar("name", { length: VARCHAR_LENGTH }).notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	userId: varchar("user_id", { length: VARCHAR_LENGTH })
		.references(() => users.id, { onDelete: "cascade" })
		.notNull(),
	attributes: json("attributes").$type<Record<string, any>>().notNull()
})

export const segments = mysqlTable("segments", {
	id: varchar("id", { length: VARCHAR_LENGTH }).primaryKey(),
	evaluator: text("evaluator").notNull()
})

export const segmentUsers = mysqlTable(
	"segment_users",
	{
		userId: varchar("user_id", { length: VARCHAR_LENGTH })
			.references(() => users.id, { onDelete: "cascade" })
			.notNull(),
		segmentId: varchar("segment_id", { length: VARCHAR_LENGTH })
			.references(() => segments.id, { onDelete: "cascade" })
			.notNull()
	},
	(table) => ({
		pk: primaryKey({ columns: [table.userId, table.segmentId] })
	})
)

export const segmentTimestampTriggers = mysqlTable(
	"segment_timestamp_triggers",
	{
		segmentId: varchar("segment_id", { length: VARCHAR_LENGTH })
			.references(() => segments.id, { onDelete: "cascade" })
			.notNull(),
		trigger: timestamp("trigger").notNull()
	}
)

export const segmentEventTriggers = mysqlTable(
	"segment_event_triggers",
	{
		segmentId: varchar("segment_id", { length: VARCHAR_LENGTH })
			.references(() => segments.id, { onDelete: "cascade" })
			.notNull(),
		event: varchar("event", { length: VARCHAR_LENGTH }).notNull()
	},
	(table) => ({
		pk: primaryKey({ columns: [table.segmentId, table.event] })
	})
)

export const campaigns = mysqlTable("campaigns", {
	id: varchar("id", { length: VARCHAR_LENGTH }).primaryKey(),
	flow: text("flow").notNull(),
	behavior: varchar("behavior", { length: VARCHAR_LENGTH })
		.notNull()
		.$type<"static" | "dynamic">()
})

export const campaignSegments = mysqlTable(
	"campaign_segments",
	{
		campaignId: varchar("campaign_id", { length: VARCHAR_LENGTH })
			.references(() => campaigns.id, { onDelete: "cascade" })
			.notNull(),
		segmentId: varchar("segment_id", { length: VARCHAR_LENGTH })
			.references(() => segments.id)
			.notNull()
	},
	(table) => ({
		pk: primaryKey({ columns: [table.campaignId, table.segmentId] })
	})
)

export const campaignExcludeSegments = mysqlTable(
	"campaign_exclude_segments",
	{
		campaignId: varchar("campaign_id", { length: VARCHAR_LENGTH })
			.references(() => campaigns.id, { onDelete: "cascade" })
			.notNull(),
		segmentId: varchar("segment_id", { length: VARCHAR_LENGTH })
			.references(() => segments.id)
			.notNull()
	},
	(table) => ({
		pk: primaryKey({ columns: [table.campaignId, table.segmentId] })
	})
)

export const campaignUsers = mysqlTable(
	"campaign_users",
	{
		userId: varchar("user_id", { length: VARCHAR_LENGTH })
			.references(() => users.id)
			.notNull(),
		campaignId: varchar("campaign_id", { length: VARCHAR_LENGTH })
			.references(() => campaigns.id, { onDelete: "cascade" })
			.notNull()
	},
	(table) => ({
		pk: primaryKey({ columns: [table.userId, table.campaignId] })
	})
)

export const executions = mysqlTable(
	"executions",
	{
		userId: varchar("user_id", { length: VARCHAR_LENGTH }).notNull(),
		campaignId: varchar("campaign_id", { length: VARCHAR_LENGTH }).notNull(),
		sleepUntil: timestamp("sleep_until").notNull().defaultNow(),
		status: varchar("status", { length: VARCHAR_LENGTH })
			.$type<
				| "pending"
				| "sleeping"
				| "running"
				| "completed"
				| "failed"
				| "terminated"
			>()
			.notNull(),
		error: varchar("error", { length: VARCHAR_LENGTH })
	},
	(table) => ({
		pk: primaryKey({ columns: [table.userId, table.campaignId] }),
		userCampaign: foreignKey({
			name: "e_user_campaign_fk",
			columns: [table.userId, table.campaignId],
			foreignColumns: [campaignUsers.userId, campaignUsers.campaignId]
		}).onDelete("cascade")
	})
)

export const executionHistory = mysqlTable(
	"execution_history",
	{
		userId: varchar("user_id", { length: VARCHAR_LENGTH }).notNull(),
		campaignId: varchar("campaign_id", { length: VARCHAR_LENGTH }).notNull(),
		stepIndex: int("step_index").notNull(),
		attributes: json("attributes").$type<UserAttributes<any>>().notNull()
	},
	(table) => ({
		pk: primaryKey({
			name: "ehs_pk",
			columns: [table.userId, table.campaignId, table.stepIndex]
		}),
		execution: foreignKey({
			name: "ehs_execution_fk",
			columns: [table.userId, table.campaignId],
			foreignColumns: [
				executions.userId,
				executions.campaignId
			]
		}).onDelete("cascade")
	})
)

export const templates = mysqlTable("templates", {
	id: varchar("id", { length: VARCHAR_LENGTH }).primaryKey(),
	subject: text("subject").notNull(),
	html: text("html").notNull(),
	preamble: text("preamble").notNull()
})

export const transactions = mysqlTable("transactions", {
	id: varchar("id", { length: VARCHAR_LENGTH }).primaryKey(),
	event: varchar("event", { length: VARCHAR_LENGTH }).notNull(),
	subject: text("subject").notNull(),
	html: text("html").notNull(),
	preamble: text("preamble").notNull()
})

export const emailProvider = mysqlTable("email_provider", {
	id: int("id").autoincrement().primaryKey(),
	config: json("config").$type<EmailProviderConfig>().notNull(),
	fromAddress: varchar("from_address", { length: VARCHAR_LENGTH }).notNull()
})

export const configs = mysqlTable("configs", {
	id: int("id").autoincrement().primaryKey(),
	configJson: json("config_json").$type<Segflow>().notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow()
})
