//import type { SegflowConfig, UserContext, Runtime } from 'segflow';
//import * as schema from 'segflow/schema'
import type { SegflowConfig, UserContext, Runtime } from "../src/client/sdk"
import * as schema from "../src/shared/schema"

import { eq, sql } from "drizzle-orm"

// Import email templates from the emails/ directory
import WelcomeEmailTemplate from "./emails/WelcomeEmailTemplate.tsx"
import PasswordResetTemplate from "./emails/PasswordResetEmailTemplate.tsx"
import DeleteAccountTemplate from "./emails/DeleteAccountEmailTemplate.tsx"
import WinbackEmailTemplate from "./emails/WinbackEmailTemplate.tsx"
import PurchaseConfirmationEmailTemplate from "./emails/PurchaseConfirmationEmailTemplate.tsx"

// Define your user attributes interface
export interface MyUserAttributes {
	name: string
	email: string

	// dynamic attributes
	winback?: boolean
}

// Export the Segflow configuration
const config: SegflowConfig<MyUserAttributes> = {
	emailProvider: {
		config: {
			name: "postmark",
			apiKey: process.env.POSTMARK_API_KEY!
		},
		fromAddress: "hello@segflow.io"
	},
	templates: {
		"welcome-email": {
			subject: (user) => `Welcome, ${user.name}!`,
			component: WelcomeEmailTemplate
		},
		"password-reset": {
			subject: (user) => `Reset Your Password, ${user.name}`,
			component: PasswordResetTemplate
		},
		"delete-account": {
			subject: (user) => `Your account has been deleted, ${user.name}`,
			component: DeleteAccountTemplate
		},
		"winback-email": {
			subject: (user) => `Winback, ${user.name}`,
			component: WinbackEmailTemplate
		}
	},
	segments: {
		"all-users": {
			evaluator: (db) => db.select({ id: schema.users.id }).from(schema.users)
		},
		"had-purchased": {
			evaluator: (db) =>
				db
					.select({
						id: schema.users.id
					})
					.from(schema.users)
					.innerJoin(schema.events, eq(schema.events.userId, schema.users.id))
					.where(eq(schema.events.name, "purchase"))
					.groupBy(schema.users.id)
		},
		"winback-eligible": {
			evaluator: (db) =>
				db
					.select({ id: schema.users.id })
					.from(schema.users)
					.where(eq(sql`${schema.users.attributes}->'$.winback'`, true))
		}
	},
	campaigns: {
		"onboarding-campaign": {
			segments: ["all-users"],
			behavior: "static",
			flow: function* (ctx: UserContext<MyUserAttributes>, rt: Runtime) {
				yield rt.sendEmail("welcome-email")
			}
		},
		"purchase-campaign": {
			segments: ["had-purchased"],
			excludeSegments: ["winback-eligible"],
			behavior: "static",
			flow: function* (ctx: UserContext<MyUserAttributes>, rt: Runtime) {
				yield rt.wait({ seconds: 2 })
				ctx.attributes.winback = true
			}
		},
		"winback-campaign": {
			segments: ["winback-eligible"],
			behavior: "dynamic",
			flow: function* (ctx: UserContext<MyUserAttributes>, rt: Runtime) {
				for (let i = 0; i < 8; i++) {
					yield rt.sendEmail("winback-email")
					yield rt.wait({ days: 2 ** i })
				}
			}
		}
	},
	transactions: {
		purchase: {
			event: "purchase",
			subject: (user) => `Purchase, ${user.name}`,
			component: PurchaseConfirmationEmailTemplate
		}
	}
}

export default config
