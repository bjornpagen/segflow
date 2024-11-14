#!/usr/bin/env bun
import path from "path"
import os from "os"
import fs from "fs"
import { Client } from "../src/client/sdk"
import dotenv from "dotenv"
import type { BaseUserAttributes } from "../src/shared/types"

dotenv.config()

const USAGE = `
Usage:
  segflow push [config-path]                    Push config to server (defaults to ./segflow.config.ts)
  segflow emit <event> <user-id> [attributes]   Emit event with attributes
  segflow add <user-id> [attributes]            Add or update user with attributes

Attribute formats:
  1. Key-value pairs:    name='Johnny Appleseed' email='johnny@example.com'
  2. JSON (with -j):     -j '{"name": "Johnny Appleseed", "email": "johnny@example.com"}'

Examples:
  segflow push
  segflow emit purchase user123 amount=99.99 currency=USD
  segflow add user123 name='Johnny Appleseed' email='johnny@example.com'
  segflow emit purchase user123 -j '{"amount": 99.99, "items": [{"id": "shirt", "qty": 2}]}'
  segflow add user123 -j '{"name": "Johnny Appleseed", "email": "johnny@example.com"}'
`

function parseAttributes(args: string[]): Record<string, any> {
	// Check for JSON flag
	const jsonFlagIndex = args.indexOf("-j")
	if (jsonFlagIndex !== -1 && jsonFlagIndex + 1 < args.length) {
		try {
			return JSON.parse(args[jsonFlagIndex + 1])
		} catch (e) {
			throw new Error(
				`Invalid JSON: ${e instanceof Error ? e.message : "Unknown error"}`
			)
		}
	}

	// Otherwise parse as key-value pairs
	const result: Record<string, any> = {}

	for (const arg of args) {
		const match = arg.match(/^([^=]+)=(.*)$/)
		if (!match) continue

		const [_, key, value] = match
		// Try to parse numbers and booleans
		if (value === "true") result[key] = true
		else if (value === "false") result[key] = false
		else if (!isNaN(Number(value))) result[key] = Number(value)
		else result[key] = value.replace(/^['"](.*)['"]$/, "$1") // Strip quotes if present
	}

	return result
}

async function getCredentials() {
	if (process.env.SEGFLOW_URL && process.env.SEGFLOW_API_KEY) {
		return {
			url: process.env.SEGFLOW_URL,
			apiKey: process.env.SEGFLOW_API_KEY
		}
	}

	const configPath = path.join(os.homedir(), ".segflow", "credentials.json")
	try {
		const content = await fs.promises.readFile(configPath, "utf-8")
		return JSON.parse(content)
	} catch (e) {
		throw new Error(
			"No credentials found. Please set SEGFLOW_URL and SEGFLOW_API_KEY environment variables"
		)
	}
}

async function loadConfig(configPath: string) {
	if (!fs.existsSync(configPath)) {
		throw new Error(`No config file found at: ${configPath}`)
	}

	try {
		const config = await import(configPath)
		return config.default
	} catch (e) {
		throw new Error(
			`Failed to load config from ${configPath}: ${e instanceof Error ? e.message : "Unknown error"}`
		)
	}
}

async function pushConfig(configPath: string) {
	const absolutePath = path.resolve(configPath)
	console.log(`Loading config from: ${absolutePath}`)

	const [credentials, config] = await Promise.all([
		getCredentials(),
		loadConfig(absolutePath)
	])

	const client = await Client.initialize(credentials)
	try {
		await client.uploadConfig(config)
		console.log("✅ Config uploaded successfully")
	} catch (e) {
		console.error("❌ Failed to upload config:", e)
		process.exit(1)
	}
}

async function emitEvent(
	eventName: string,
	userId: string,
	attributes: Record<string, any>
) {
	const credentials = await getCredentials()
	const client = await Client.initialize(credentials)

	try {
		await client.emit(userId, eventName, attributes)
		console.log("✅ Event emitted successfully")
	} catch (e) {
		console.error("❌ Failed to emit event:", e)
		process.exit(1)
	}
}

async function addUser(
	userId: string,
	attributes: BaseUserAttributes & Record<string, any>
) {
	const credentials = await getCredentials()
	const client = await Client.initialize(credentials)

	if (!("email" in attributes) || typeof attributes.email !== "string") {
		console.error("❌ User attributes must include an email field")
		process.exit(1)
	}

	try {
		await client.createUser(userId, attributes)
		console.log("✅ User created successfully")
	} catch (e) {
		console.error("❌ Failed to create user:", e)
		process.exit(1)
	}
}

async function updateUser(
	userId: string,
	attributes: Record<string, any>
) {
	const credentials = await getCredentials()
	const client = await Client.initialize(credentials)

	try {
		await client.updateUser(userId, attributes)
		console.log("✅ User updated successfully")
	} catch (e) {
		console.error("❌ Failed to update user:", e)
		process.exit(1)
	}
}

async function main() {
	const [command, ...args] = process.argv.slice(2)

	switch (command) {
		case "push":
			await pushConfig(args[0] || path.join(process.cwd(), "segflow.config.ts"))
			break

		case "emit": {
			const [eventName, userId, ...restArgs] = args

			if (!eventName || !userId) {
				console.error("Usage: segflow emit <event> <user-id> [attributes]")
				process.exit(1)
			}

			try {
				const attributes = parseAttributes(restArgs)
				await emitEvent(eventName, userId, attributes)
			} catch (e) {
				console.error("❌", e instanceof Error ? e.message : e)
				process.exit(1)
			}
			break
		}

		case "add": {
			const [userId, ...restArgs] = args

			if (!userId) {
				console.error("Usage: segflow add <user-id> [attributes]")
				process.exit(1)
			}

			try {
				const attributes = parseAttributes(restArgs)
				if (!("email" in attributes) || typeof attributes.email !== "string") {
					console.error("❌ User attributes must include an email field")
					process.exit(1)
				}

				await addUser(
					userId,
					attributes as BaseUserAttributes & Record<string, any>
				)
			} catch (e) {
				console.error("❌", e instanceof Error ? e.message : e)
				process.exit(1)
			}
			break
		}

		case "update": {
			const [userId, ...restArgs] = args

			if (!userId) {
				console.error("Usage: segflow update <user-id> [attributes]")
				process.exit(1)
			}

			await updateUser(userId, parseAttributes(restArgs))
			break
		}

		case "help":
		case undefined:
			console.log(USAGE)
			break

		default:
			console.error("Unknown command:", command)
			console.log(USAGE)
			process.exit(1)
	}
}

main().catch((e) => {
	console.error("❌", e instanceof Error ? e.message : e)
	process.exit(1)
})
