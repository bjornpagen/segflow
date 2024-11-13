import type {
	PostmarkEmailProviderConfig,
	SESEmailProviderConfig
} from "../shared/types"
import type { MySql2Database } from "drizzle-orm/mysql2"
import * as schema from "../shared/schema"
import { eq } from "drizzle-orm"

export async function getEmailProvider(db: MySql2Database<typeof schema>) {
	const config = await db
		.select({
			config: schema.emailProvider.config,
			fromAddress: schema.emailProvider.fromAddress
		})
		.from(schema.emailProvider)
		.where(eq(schema.emailProvider.id, 1))
		.limit(1)

	if (!config[0]) {
		throw new Error("No email provider configured")
	}

	return config[0]
}

export async function sendEmail(
	db: MySql2Database<typeof schema>,
	to: string,
	subject: string,
	html: string
) {
	const provider = await getEmailProvider(db)
	switch (provider.config.name) {
		case "postmark":
			return sendPostmarkEmail(
				to,
				subject,
				html,
				provider.config,
				provider.fromAddress
			)
		case "ses":
			return sendSESEmail(
				to,
				subject,
				html,
				provider.config,
				provider.fromAddress
			)
	}
}

async function sendPostmarkEmail(
	to: string,
	subject: string,
	html: string,
	config: PostmarkEmailProviderConfig,
	fromAddress: string
) {
	const response = await fetch("https://api.postmarkapp.com/email", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"X-Postmark-Server-Token": config.apiKey
		},
		body: JSON.stringify({
			From: fromAddress,
			To: to,
			Subject: subject,
			HtmlBody: html
		})
	})

	if (!response.ok) {
		throw new Error(`Postmark API error: ${await response.text()}`)
	}

	return response.json()
}

async function sendSESEmail(
	to: string,
	subject: string,
	html: string,
	config: SESEmailProviderConfig,
	fromAddress: string
) {
	const AWS = require("aws-sdk")

	const ses = new AWS.SES({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		region: "us-east-1" // You might want to make this configurable
	})

	const params = {
		Destination: {
			ToAddresses: [to]
		},
		Message: {
			Body: {
				Html: {
					Charset: "UTF-8",
					Data: html
				}
			},
			Subject: {
				Charset: "UTF-8",
				Data: subject
			}
		},
		Source: fromAddress
	}

	return ses.sendEmail(params).promise()
}
