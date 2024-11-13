import type { MySql2Database } from "drizzle-orm/mysql2"
import type * as schema from "./schema"

// Base Types
export interface BaseUserAttributes {
	email: string
	phone?: string
}

export type UserAttributes<T extends Record<string, any> = {}> = T & {
	[K in keyof BaseUserAttributes]: BaseUserAttributes[K]
}

// Event & Segment Types
export type User = Omit<typeof schema.users.$inferSelect, "id">
export type Event = Omit<typeof schema.events.$inferSelect, "id">
export type Segment = Omit<typeof schema.segments.$inferSelect, "id">
export type Campaign = Omit<typeof schema.campaigns.$inferSelect, "id"> & {
	segments: string[]
	excludeSegments?: string[]
}
export type Template = Omit<typeof schema.templates.$inferSelect, "id">

// Response Types
export interface SegmentStats {
	added: string[]
	removed: string[]
}

export interface CampaignChange {
	type: "added" | "removed"
	userId: string
	campaignId: string
}

export interface UserOperationResponse {
	segmentUpdates?: {
		added: string[]
		removed: string[]
	}
	campaignUpdates?: {
		added: string[]
		removed: string[]
	}
}

export interface CreateSegmentResponse {
	eventTriggers: string[]
	stats: SegmentStats
	campaignUpdates: CampaignChange[]
}

export interface CreateCampaignResponse {
	initialMemberCount: number
}

export interface DeleteCampaignResponse {
	deletedMemberships: number
	deletedExecutions: number
}

export interface TimeUnits {
	seconds?: number
	minutes?: number
	hours?: number
	days?: number
	weeks?: number
}

export type Duration = {
	[K in keyof TimeUnits]: Pick<TimeUnits, K> & Partial<Omit<TimeUnits, K>>
}[keyof TimeUnits]

export type RuntimeCommand =
	| { type: "SEND_EMAIL"; templateId: string }
	| { type: "SEND_SMS"; message: { body: string } } // TODO: implement SMS sending
	| { type: "WAIT"; duration: Duration }

// Map command types to their yield values
export type RuntimeYieldMap = {
	SEND_EMAIL: { success: boolean }
	SEND_SMS: { success: boolean }
	WAIT: { date: Date }
}

// Create yield type from the map
export type RuntimeYield<
	T extends RuntimeCommand["type"] = RuntimeCommand["type"]
> = { type: T } & RuntimeYieldMap[T]

export interface Runtime {
	sendEmail: (templateId: string) => RuntimeCommand
	sendSMS: (message: { body: string }) => RuntimeCommand
	wait: (duration: Duration) => RuntimeCommand
	waitForEvent: (event: string) => RuntimeCommand
}

export type UserContext<T extends BaseUserAttributes> = {
	attributes: T
}

export type Flow<T extends BaseUserAttributes> = (
	ctx: UserContext<T>,
	rt: Runtime
) => Generator<RuntimeCommand, void, unknown>

export type PostmarkEmailProviderConfig = {
	name: "postmark"
	apiKey: string
}
export type SESEmailProviderConfig = {
	name: "ses"
	accessKeyId: string
	secretAccessKey: string
	region: string
}
export type EmailProviderConfig =
	| PostmarkEmailProviderConfig
	| SESEmailProviderConfig

export type EmailProvider = {
	config: EmailProviderConfig
	fromAddress: string
}

export type SuccessResponse<T = void> = { success: true } & (T extends void
	? {}
	: { value: T })
export type ErrorResponse = { error: string }
export type ApiResponse<T = void> = SuccessResponse<T> | ErrorResponse

export type Segflow = {
	templates: Record<string, Template>
	segments: Record<string, Segment>
	campaigns: Record<string, Campaign>
	transactions: Record<string, Transaction>
	emailProvider: EmailProvider
}

export type ClientConfig = {
	url: string
	apiKey: string
}

export type SegflowConfig<T extends BaseUserAttributes> = {
	templates: Record<string, EmailTemplateConfig<T>>
	segments: Record<string, SegmentConfig>
	campaigns: Record<string, CampaignConfig<T>>
	transactions: Record<string, TransactionConfig<T>>
	emailProvider: EmailProvider
}

export type EmailTemplateConfig<T extends BaseUserAttributes> = {
	subject: (user: T) => string
	component: React.FunctionComponent<{ user: T }>
}

type SegmentConfig = {
	evaluator: (db: MySql2Database<typeof schema>) => any
}

export type CampaignConfig<T extends BaseUserAttributes> = {
	segments: string[]
	excludeSegments?: string[]
	behavior: "static" | "dynamic"
	flow: Flow<T>
}

export type Transaction = Omit<typeof schema.transactions.$inferSelect, "id">
export type TransactionConfig<T extends BaseUserAttributes> = {
	event: string
	subject: (user: T, event: Record<string, any>) => string
	component: React.FunctionComponent<{ user: T; event: Record<string, any> }>
}
