import { drizzle, type MySql2Database } from "drizzle-orm/mysql2"
import type * as schema from "../shared/schema"
import type {
	BaseUserAttributes,
	UserOperationResponse,
	CreateSegmentResponse,
	CreateCampaignResponse,
	Event,
	Segment,
	Campaign,
	CampaignConfig,
	DeleteCampaignResponse,
	ApiResponse,
	Template,
	SegflowConfig,
	ClientConfig,
	Runtime,
	UserContext,
	EmailTemplateConfig,
	TransactionConfig,
	Transaction
} from "../shared/types"
import { render } from "@react-email/render"
import React from "react"
import { transformComponentComplex } from "./ast"
import * as ReactEmail from "@react-email/components"
import { jsxDEV } from "react/jsx-dev-runtime"
import type { Segflow } from "../shared/types"

const DATABASE_URL = "mysql://user@localhost:3306/dummy_db"

const db = drizzle<typeof schema>(DATABASE_URL)

type DrizzleSQLResult = {
	sql: string
	params: Array<string | number | boolean | null>
}

function toSQL(evaluator: (db: MySql2Database<typeof schema>) => any): string {
	const sqlObj: DrizzleSQLResult = evaluator(db).toSQL()

	let finalSql = sqlObj.sql

	sqlObj.params.forEach((param) => {
		if (typeof param === "string") {
			finalSql = finalSql.replace("?", `'${param}'`)
		} else if (param === null) {
			finalSql = finalSql.replace("?", "NULL")
		} else {
			finalSql = finalSql.replace("?", String(param))
		}
	})

	return finalSql
}

export class Client<T extends BaseUserAttributes> {
	private constructor(
		private baseUrl: string,
		private authToken: string
	) {}

	private async fetch<R = void>(path: string, init?: RequestInit): Promise<R> {
		const response = await fetch(`${this.baseUrl}/api${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.authToken}`,
				"Content-Type": "application/json",
				...init?.headers
			}
		})

		const data = (await response.json()) as ApiResponse<R>

		if ("error" in data) {
			throw new Error(data.error)
		} else if ("success" in data && data.success && "value" in data) {
			return data.value as R
		}

		return undefined as R
	}

	static async initialize<T extends BaseUserAttributes>(
		credentials: ClientConfig
	): Promise<Client<T>> {
		return new Client<T>(credentials.url, credentials.apiKey)
	}

	async createUser(id: string, attributes: T): Promise<UserOperationResponse> {
		return this.fetch(`/user/${id}`, {
			method: "POST",
			body: JSON.stringify({ attributes })
		})
	}

	async updateUser(
		id: string,
		attributes: Partial<T>
	): Promise<UserOperationResponse> {
		return this.fetch(`/user/${id}`, {
			method: "PATCH",
			body: JSON.stringify({ attributes })
		})
	}

	async getUser(id: string): Promise<T> {
		return this.fetch(`/user/${id}`)
	}

	async deleteUser(id: string): Promise<void> {
		return this.fetch(`/user/${id}`, {
			method: "DELETE"
		})
	}

	async emit(
		userId: string,
		name: string,
		attributes: Record<string, any> = {}
	): Promise<UserOperationResponse> {
		return this.fetch(`/user/${userId}/event/${name}`, {
			method: "POST",
			body: JSON.stringify({ attributes })
		})
	}

	async getUserEvents(userId: string): Promise<Event[]> {
		return this.fetch(`/user/${userId}/event`)
	}

	async getSegmentUsers(segmentId: string): Promise<string[]> {
		return this.fetch(`/segment/${segmentId}/user`)
	}

	async getUserSegments(userId: string): Promise<string[]> {
		return this.fetch(`/user/${userId}/segment`)
	}

	async createSegment(
		name: string,
		evaluator: (db: MySql2Database<typeof schema>) => any
	): Promise<CreateSegmentResponse> {
		const body = JSON.stringify(createSegmentObject(evaluator))
		return this.fetch(`/segment/${name}`, {
			method: "POST",
			body
		})
	}

	async getSegments(): Promise<Segment[]> {
		return this.fetch("/segment")
	}

	async getSegment(id: string): Promise<Segment> {
		return this.fetch(`/segment/${id}`)
	}

	async deleteSegment(id: string): Promise<void> {
		return this.fetch(`/segment/${id}`, {
			method: "DELETE"
		})
	}

	async createCampaign(
		id: string,
		params: CampaignConfig<T>
	): Promise<CreateCampaignResponse> {
		const body = JSON.stringify(createCampaignObject(params))
		return this.fetch(`/campaign/${id}`, {
			method: "POST",
			body
		})
	}

	async deleteCampaign(id: string): Promise<DeleteCampaignResponse> {
		return this.fetch(`/campaign/${id}`, {
			method: "DELETE"
		})
	}

	async getCampaigns(): Promise<Campaign[]> {
		return this.fetch("/campaign")
	}

	async createTemplate<T extends BaseUserAttributes>(
		id: string,
		template: EmailTemplateConfig<T>
	): Promise<void> {
		const body = JSON.stringify(await createTemplateObject(template))
		return this.fetch(`/template/${id}`, {
			method: "POST",
			body
		})
	}

	async getTemplate(id: string): Promise<Template> {
		return this.fetch(`/template/${id}`)
	}

	// async setEmailConfig(
	//   provider: EmailProviderType,
	//   config: EmailProviderConfig<typeof provider>,
	//   fromAddress: string
	// ): Promise<SetEmailConfigResponse> {
	//   return this.fetch('/email/config', {
	//     method: 'POST',
	//     body: JSON.stringify({ provider, config, fromAddress })
	//   });
	// }

	// async getEmailConfig(): Promise<{
	//   name: EmailProviderType;
	//   config: EmailProviderConfig<EmailProviderType>;
	//   fromAddress: string;
	// }> {
	//   return this.fetch('/email/config');
	// }

	async getCampaign(id: string): Promise<Campaign> {
		return this.fetch(`/campaign/${id}`)
	}

	async deleteTemplate(id: string): Promise<void> {
		return this.fetch(`/template/${id}`, {
			method: "DELETE"
		})
	}

	async updateTemplate<T extends BaseUserAttributes>(
		id: string,
		template: EmailTemplateConfig<T>
	): Promise<void> {
		const body = JSON.stringify(await createTemplateObject(template))
		return this.fetch(`/template/${id}`, {
			method: "PATCH",
			body
		})
	}

	async updateSegment(
		id: string,
		evaluator: (db: MySql2Database<typeof schema>) => any
	): Promise<CreateSegmentResponse> {
		const body = JSON.stringify(createSegmentObject(evaluator))
		return this.fetch(`/segment/${id}`, {
			method: "PATCH",
			body
		})
	}

	/**
	 * Uploads the SegflowConfig to the server.
	 * Does not validate the config.
	 * @param config The serialized SegflowConfig object.
	 */
	async uploadConfig(config: SegflowConfig<T>): Promise<number> {
		const body = JSON.stringify(await createConfigObject(config))
		return this.fetch("/config", {
			method: "POST",
			body
		})
	}
}

function inferMangledJSXCalls(code: string) {
	const regex = /\b(jsxDEV_[a-zA-Z0-9]+)\b/g
	return [...code.matchAll(regex)].map((match) => match[1])
}

function inferMangledFragmentCalls(code: string) {
	const regex = /\b(Fragment_[a-zA-Z0-9]+)\b/g
	return [...code.matchAll(regex)].map((match) => match[1])
}

/**
 * Creates the request body object for a template.
 * @param template The EmailTemplate object.
 * @returns A Promise that resolves to the object containing subject and html.
 */
async function createTemplateObject<T extends BaseUserAttributes>(
	template: EmailTemplateConfig<T>
): Promise<Template> {
	const { subject, component } = template
	const { transformedComponent, preamble } =
		transformComponentComplex(component)
	const mangledFragments = inferMangledFragmentCalls(transformedComponent)
	const mangledJSXCalls = inferMangledJSXCalls(transformedComponent)

	const ctx: any = {
		...ReactEmail
	}

	for (const mangledFragment of mangledFragments) {
		ctx[mangledFragment] = React.Fragment
	}

	for (const mangledJSXCall of mangledJSXCalls) {
		ctx[mangledJSXCall] = jsxDEV
	}

	const NewComponent = new Function(
		...Object.keys(ctx),
		`return ${transformedComponent};`
	)(...Object.values(ctx))

		const html = (await render(React.createElement(NewComponent))).replace(
			/&lt;%=\s*(.*?)\s*%&gt;/g,
			"<%=$1%>"
		)


	return { subject: subject.toString(), html, preamble }
}

/**
 * Creates the request body object for a segment.
 * @param name The name of the segment.
 * @param evaluator The evaluator function.
 * @returns The object containing name and evaluator SQL string.
 */
function createSegmentObject(
	evaluator: (db: MySql2Database<typeof schema>) => any
): { evaluator: string } {
	return { evaluator: toSQL(evaluator) }
}

/**
 * Creates the request body object for a campaign.
 * @param params The campaign parameters.
 * @returns The object containing flow, segments, excludeSegments, and behavior.
 */
function createCampaignObject<T extends BaseUserAttributes>(
	params: CampaignConfig<T>
): {
	flow: string
	segments: string[]
	excludeSegments?: string[]
	behavior: "static" | "dynamic"
} {
	return {
		flow: params.flow.toString(),
		segments: params.segments,
		excludeSegments: params.excludeSegments,
		behavior: params.behavior
	}
}

async function createTransactionObject<T extends BaseUserAttributes>(
	params: TransactionConfig<T>
): Promise<Transaction> {
	const { event, subject, component } = params
	const { transformedComponent, preamble } =
		transformComponentComplex(component)
	const mangledFragments = inferMangledFragmentCalls(transformedComponent)
	const mangledJSXCalls = inferMangledJSXCalls(transformedComponent)

	const ctx: any = {
		...ReactEmail
	}

	for (const mangledFragment of mangledFragments) {
		ctx[mangledFragment] = React.Fragment
	}

	for (const mangledJSXCall of mangledJSXCalls) {
		ctx[mangledJSXCall] = jsxDEV
	}

	const NewComponent = new Function(
		...Object.keys(ctx),
		`return ${transformedComponent};`
	)(...Object.values(ctx))

	const html = (await render(React.createElement(NewComponent))).replace(
		/&lt;%=\s*(.*?)\s*%&gt;/g,
		"<%=$1%>"
	)

	return {
		event,
		subject: subject.toString(),
		html,
		preamble
	}
}

/**
 * Serializes the SegflowConfig into a JSON string.
 * @param config The SegflowConfig object containing templates, segments, and campaigns.
 * @returns A Promise that resolves to the JSON stringified configuration.
 */
export async function createConfigObject<T extends BaseUserAttributes>(
	config: SegflowConfig<T>
): Promise<Segflow> {
	const { templates, segments, campaigns, transactions, emailProvider } = config

	const serializedTemplates: Record<string, Template> = {}
	for (const [templateId, template] of Object.entries(templates)) {
		const templateBody = await createTemplateObject(template)
		serializedTemplates[templateId] = templateBody
	}

	const serializedSegments: Record<string, { evaluator: string }> = {}
	for (const [segmentId, segment] of Object.entries(segments)) {
		const segmentBody = createSegmentObject(segment.evaluator)
		serializedSegments[segmentId] = segmentBody
	}

	const serializedCampaigns: Record<
		string,
		{
			flow: string
			segments: string[]
			excludeSegments?: string[]
			behavior: "static" | "dynamic"
		}
	> = {}

	for (const [campaignId, campaignParams] of Object.entries(campaigns)) {
		const campaignBody = createCampaignObject(campaignParams)
		serializedCampaigns[campaignId] = campaignBody
	}

	const serializedTransactions: Record<string, Transaction> = {}

	for (const [transactionId, transactionParams] of Object.entries(
		transactions
	)) {
		const transactionBody = await createTransactionObject(transactionParams)
		serializedTransactions[transactionId] = transactionBody
	}

	return {
		templates: serializedTemplates,
		segments: serializedSegments,
		campaigns: serializedCampaigns,
		transactions: serializedTransactions,
		emailProvider
	}
}

export type { SegflowConfig, UserContext, Runtime }
