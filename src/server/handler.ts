import { Hono, type Context } from "hono"
import * as schema from "../shared/schema"
import { eq } from "drizzle-orm"
import { z } from "zod"
import type { MySql2Database } from "drizzle-orm/mysql2"
import { fromZodError, type ZodError } from "zod-validation-error"

import * as services from "./services"

import type {
	UserOperationResponse,
	CreateSegmentResponse,
	CreateCampaignResponse,
	DeleteCampaignResponse,
	Campaign,
	Event,
	Segment,
	ErrorResponse,
	ApiResponse,
	Template
} from "../shared/types"

interface HandlerConfig {
	apiKey: string
	db: MySql2Database<typeof schema>
}

function createApiHandler<T = void>(
	handler: (c: Context) => Promise<ApiResponse<T>>
): (c: Context) => Promise<Response> {
	return async (c) => {
		try {
			const result = await handler(c)
			return c.json<ApiResponse<T>>(result, "success" in result ? 200 : 400)
		} catch (error) {
			console.error(error)
			return c.json<ErrorResponse>(
				{
					error:
						error instanceof Error ? error.message : "Internal server error"
				},
				500
			)
		}
	}
}

export function createHandler({ apiKey, db }: HandlerConfig) {
	const app = new Hono()

	app.use("*", async (c, next) => {
		if (c.req.path === "/api/auth") return next()

		const authHeader = c.req.header("Authorization")
		if (authHeader !== `Bearer ${apiKey}`) {
			return c.json<ErrorResponse>({ error: "Unauthorized" }, 401)
		}

		await next()
	})

	app.post(
		"/api/user/:id",
		createApiHandler<UserOperationResponse>(async (c) => {
			const userId = c.req.param("id")
			const body = await c.req.json()
			const validation = validateRequest(CreateUserSchema, body)
			if (!validation.success) {
				return {
					error:
						"Validation error: " + fromZodError(validation.errors).toString()
				}
			}

			const value = await services.createUser(
				db,
				userId,
				validation.data.attributes
			)
			return {
				success: true,
				value
			}
		})
	)

	app.patch(
		"/api/user/:id",
		createApiHandler<UserOperationResponse>(async (c) => {
			const userId = c.req.param("id")
			const body = await c.req.json()
			const validation = validateRequest(UpdateUserSchema, body)
			if (!validation.success) {
				return {
					error:
						"Validation error: " + fromZodError(validation.errors).toString()
				}
			}

			const value = await services.updateUser(
				db,
				userId,
				validation.data.attributes
			)
			return {
				success: true,
				value
			}
		})
	)

	app.get(
		"/api/user/:id",
		createApiHandler(async (c) => {
			const userId = c.req.param("id")
			const value = await services.getUser(db, userId)
			return {
				success: true,
				value
			}
		})
	)

	app.delete(
		"/api/user/:id",
		createApiHandler(async (c) => {
			const userId = c.req.param("id")
			await services.deleteUser(db, userId)
			return {
				success: true
			}
		})
	)

	app.post(
		"/api/user/:id/event/:name",
		createApiHandler<UserOperationResponse>(async (c) => {
			const userId = c.req.param("id")
			const name = c.req.param("name")
			const body = await c.req.json()
			const validation = validateRequest(CreateEventSchema, body)
			if (!validation.success) {
				return {
					error:
						"Validation error: " + fromZodError(validation.errors).toString()
				}
			}

			const value = await services.createEvent(
				db,
				userId,
				name,
				validation.data.attributes
			)
			return {
				success: true,
				value
			}
		})
	)

	app.get(
		"/api/user/:id/event",
		createApiHandler<Omit<Event, "userId">[]>(async (c) => {
			const userId = c.req.param("id")
			const events = await db
				.select({
					name: schema.events.name,
					createdAt: schema.events.createdAt,
					attributes: schema.events.attributes
				})
				.from(schema.events)
				.where(eq(schema.events.userId, userId))
			return {
				success: true,
				value: events
			}
		})
	)

	app.post(
		"/api/segment/:id",
		createApiHandler<CreateSegmentResponse>(async (c) => {
			const segmentId = c.req.param("id")
			const body = await c.req.json()
			const validation = validateRequest(CreateSegmentSchema, body)
			if (!validation.success) {
				return {
					error:
						"Validation error: " + fromZodError(validation.errors).toString()
				}
			}

			const value = await services.createSegment(
				db,
				segmentId,
				validation.data.evaluator
			)
			return {
				success: true,
				value
			}
		})
	)

	app.get(
		"/api/segment",
		createApiHandler<Segment[]>(async (c) => {
			const value = await services.getSegments(db)
			return {
				success: true,
				value
			}
		})
	)

	app.get(
		"/api/user/:id/segment",
		createApiHandler<string[]>(async (c) => {
			const userId = c.req.param("id")
			const value = await services.getUserSegments(db, userId)
			return {
				success: true,
				value
			}
		})
	)

	app.get(
		"/api/segment/:id",
		createApiHandler<Segment>(async (c) => {
			const segmentId = c.req.param("id")
			const value = await services.getSegment(db, segmentId)
			return {
				success: true,
				value
			}
		})
	)

	app.delete(
		"/api/segment/:id",
		createApiHandler(async (c) => {
			const segmentId = c.req.param("id")
			await services.deleteSegment(db, segmentId)
			return {
				success: true
			}
		})
	)

	app.patch(
		"/api/segment/:id",
		createApiHandler<CreateSegmentResponse>(async (c) => {
			const segmentId = c.req.param("id")
			const body = await c.req.json()
			const validation = validateRequest(UpdateSegmentSchema, body)
			if (!validation.success) {
				return {
					error:
						"validation error: " + fromZodError(validation.errors).toString()
				}
			}

			const value = await services.updateSegment(
				db,
				segmentId,
				validation.data.evaluator
			)
			return {
				success: true,
				value
			}
		})
	)

	app.post(
		"/api/campaign/:id",
		createApiHandler<CreateCampaignResponse>(async (c) => {
			const campaignId = c.req.param("id")
			const body = await c.req.json()
			const validation = validateRequest(CreateCampaignSchema, body)
			if (!validation.success) {
				return {
					error:
						"validation error: " + fromZodError(validation.errors).toString()
				}
			}

			const value = await services.createCampaign(
				db,
				campaignId,
				validation.data.flow,
				validation.data.behavior,
				validation.data.segments,
				validation.data.excludeSegments
			)
			return {
				success: true,
				value
			}
		})
	)

	app.delete(
		"/api/campaign/:id",
		createApiHandler<DeleteCampaignResponse>(async (c) => {
			const campaignId = c.req.param("id")
			const value = await services.deleteCampaign(db, campaignId)
			return {
				success: true,
				value
			}
		})
	)

	app.get(
		"/api/campaign",
		createApiHandler<Campaign[]>(async (c) => {
			const value = await services.getCampaigns(db)
			return {
				success: true,
				value
			}
		})
	)

	app.get(
		"/api/segment/:id/user",
		createApiHandler<string[]>(async (c) => {
			const segmentId = c.req.param("id")
			const value = await services.getSegmentUsers(db, segmentId)
			return {
				success: true,
				value
			}
		})
	)

	app.post(
		"/api/template/:id",
		createApiHandler(async (c) => {
			const id = c.req.param("id")
			const body = await c.req.json()
			const validation = validateRequest(CreateTemplateSchema, body)
			if (!validation.success) {
				return {
					error:
						"validation error: " + fromZodError(validation.errors).toString()
				}
			}

			const value = await services.createTemplate(
				db,
				id,
				validation.data.subject,
				validation.data.html,
				validation.data.preamble
			)
			return {
				success: true,
				value
			}
		})
	)

	app.get(
		"/api/template/:id",
		createApiHandler<Template>(async (c) => {
			const id = c.req.param("id")
			const value = await services.getTemplate(db, id)
			return {
				success: true,
				value
			}
		})
	)

	app.post(
		"/api/email/config",
		createApiHandler(async (c) => {
			const body = await c.req.json()
			const validation = validateRequest(EmailProviderSchema, body)
			if (!validation.success) {
				return {
					error:
						"Validation error: " + fromZodError(validation.errors).toString()
				}
			}

			await services.setEmailProvider(db, validation.data)
			return {
				success: true
			}
		})
	)

	app.delete(
		"/api/template/:id",
		createApiHandler(async (c) => {
			const id = c.req.param("id")
			await services.deleteTemplate(db, id)
			return {
				success: true
			}
		})
	)

	app.patch(
		"/api/template/:id",
		createApiHandler(async (c) => {
			const id = c.req.param("id")
			const body = await c.req.json()
			const validation = validateRequest(CreateTemplateSchema, body)
			if (!validation.success) {
				return {
					error:
						"Validation error: " + fromZodError(validation.errors).toString()
				}
			}

			const value = await services.updateTemplate(
				db,
				id,
				validation.data.subject,
				validation.data.html,
				validation.data.preamble
			)
			return {
				success: true,
				value
			}
		})
	)

	app.post(
		"/api/config",
		createApiHandler(async (c) => {
			const body = await c.req.json()
			const validation = validateRequest(SegflowSchema, body)
			if (!validation.success) {
				return {
					error:
						"Validation error: " + fromZodError(validation.errors).toString()
				}
			}

			const value = await services.createConfig(db, validation.data)
			return {
				success: true,
				value
			}
		})
	)

	app.onError((err, c) => {
		console.error("Server error:", err)
		return c.json<ErrorResponse>(
			{
				error: err.message
			},
			500
		)
	})

	return {
		fetch: app.fetch,
		db: db
	}
}

// stricter on create, since we need email to be present
const CreateUserSchema = z.object({
	attributes: z
		.object({
			email: z.string()
		})
		.passthrough()
})

const UpdateUserSchema = z.object({
	attributes: z.record(z.string(), z.any())
})

const CreateEventSchema = z.object({
	attributes: z.record(z.string(), z.any())
})

const CreateSegmentSchema = z.object({
	evaluator: z.string()
})

const CreateCampaignSchema = z.object({
	behavior: z.enum(["static", "dynamic"]),
	flow: z.string(),
	segments: z.array(z.string()),
	excludeSegments: z.array(z.string()).optional()
})

const UpdateSegmentSchema = z.object({
	evaluator: z.string()
})

const CreateTemplateSchema = z.object({
	subject: z.string(),
	html: z.string(),
	preamble: z.string()
})

const EmailProviderSchema = z.object({
	config: z.discriminatedUnion("name", [
		z.object({
			name: z.literal("postmark"),
			apiKey: z.string()
		}),
		z.object({
			name: z.literal("ses"),
			accessKeyId: z.string(),
			secretAccessKey: z.string(),
			region: z.string()
		})
	]),
	fromAddress: z.string().email()
})

const TemplateSchema = z.object({
	subject: z.string(),
	html: z.string(),
	preamble: z.string()
})

const SegmentSchema = z.object({
	evaluator: z.string()
})

const CampaignSchema = z.object({
	flow: z.string(),
	segments: z.array(z.string()),
	excludeSegments: z.array(z.string()).optional(),
	behavior: z.enum(["static", "dynamic"])
})

const TransactionSchema = z.object({
	event: z.string(),
	subject: z.string(),
	html: z.string(),
	preamble: z.string()
})

const SegflowSchema = z.object({
	templates: z.record(z.string(), TemplateSchema),
	segments: z.record(z.string(), SegmentSchema),
	campaigns: z.record(z.string(), CampaignSchema),
	transactions: z.record(z.string(), TransactionSchema),
	emailProvider: EmailProviderSchema
})

function validateRequest<T>(
	schema: z.ZodSchema<T>,
	data: unknown
): { success: true; data: T } | { success: false; errors: ZodError } {
	const result = schema.safeParse(data)

	if (!result.success) {
		return {
			success: false,
			errors: result.error
		}
	}

	return {
		success: true,
		data: result.data
	}
}
