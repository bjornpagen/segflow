import { describe, test, expect } from "bun:test"
import { getQuickJS, Scope } from "quickjs-emscripten"
import {
	executeGeneratorToIndex,
	convertArbitraryObjectToJSValue,
	buildRuntimeContext,
	evalSandboxedWithUser,
	renderTemplate,
	renderTransaction
} from "./quickjs"
import type { BaseUserAttributes } from "../shared/types"

interface TestUserAttributes extends BaseUserAttributes {
	name: string
	email: string
}

describe("Executor", () => {
	describe("convertArbitraryObjectToJSValue", () => {
		test("should handle primitive types", async () => {
			const QuickJS = await getQuickJS()

			await Scope.withScope(async (scope) => {
				const vm = scope.manage(QuickJS.newContext())

				// Test string
				const strValue = convertArbitraryObjectToJSValue(scope, vm, "test")
				expect(vm.dump(strValue)).toBe("test")

				// Test number
				const numValue = convertArbitraryObjectToJSValue(scope, vm, 42)
				expect(vm.dump(numValue)).toBe(42)

				// Test boolean
				const boolValue = convertArbitraryObjectToJSValue(scope, vm, true)
				expect(vm.dump(boolValue)).toBe(true)

				// Test null
				const nullValue = convertArbitraryObjectToJSValue(scope, vm, null)
				expect(vm.dump(nullValue)).toBe(null)
			})
		})

		test("should handle nested objects", async () => {
			const QuickJS = await getQuickJS()

			await Scope.withScope(async (scope) => {
				const vm = scope.manage(QuickJS.newContext())

				const testObj = {
					name: "test",
					nested: {
						value: 42,
						array: [1, 2, 3]
					}
				}

				const jsValue = convertArbitraryObjectToJSValue(scope, vm, testObj)
				expect(vm.dump(jsValue)).toEqual(testObj)
			})
		})
	})

	describe("buildRuntimeContext", () => {
		test("should create runtime with all expected methods", async () => {
			const QuickJS = await getQuickJS()

			await Scope.withScope(async (scope) => {
				const vm = scope.manage(QuickJS.newContext())
				const runtime = buildRuntimeContext(scope, vm)

				const methods = ["sendEmail", "sendSMS", "wait", "waitForEvent"]
				for (const method of methods) {
					const prop = scope.manage(vm.getProp(runtime, method))
					expect(prop).toBeDefined()
				}
			})
		})

		test("runtime methods should return correct command objects", async () => {
			const QuickJS = await getQuickJS()

			await Scope.withScope(async (scope) => {
				const vm = scope.manage(QuickJS.newContext())
				const runtime = buildRuntimeContext(scope, vm)

				// Test sendEmail
				const emailTemplate = scope.manage(vm.newString("test"))
				const emailCmd = scope.manage(
					vm
						.callFunction(
							scope.manage(vm.getProp(runtime, "sendEmail")),
							runtime,
							[emailTemplate]
						)
						.unwrap()
				)
				expect(vm.dump(emailCmd)).toMatchObject({
					type: "SEND_EMAIL",
					templateId: "test"
				})

				// Test wait
				const waitDuration = convertArbitraryObjectToJSValue(scope, vm, {
					days: 5
				})
				const waitCmd = scope.manage(
					vm
						.callFunction(scope.manage(vm.getProp(runtime, "wait")), runtime, [
							waitDuration
						])
						.unwrap()
				)
				expect(vm.dump(waitCmd)).toMatchObject({
					type: "WAIT",
					duration: { days: 5 }
				})
			})
		})
	})

	describe("executeGeneratorToIndex", () => {
		const testGenerator = String.raw`
      function* (ctx, rt) {
        yield rt.sendEmail({
          subject: 'Hello ' + ctx.attributes.name,
          template: 'test'
        });
        yield rt.wait({ days: 1 });
        yield rt.sendSMS({ message: 'Hi again!' });
      }
    `

		test("should execute generator to specified index", async () => {
			const attributes: TestUserAttributes[] = [
				{ name: "Alice", email: "alice@test.com" },
				{ name: "Alice", email: "alice@test.com" },
				{ name: "Alice", email: "alice@test.com" }
			]

			// Test first yield
			const result0 = await executeGeneratorToIndex(
				testGenerator,
				attributes,
				0
			)
			expect(result0.value?.type).toBe("SEND_EMAIL")
			expect(result0.done).toBe(false)

			// Test second yield
			const result1 = await executeGeneratorToIndex(
				testGenerator,
				attributes,
				1
			)
			expect(result1.value?.type).toBe("WAIT")
			expect(result1.done).toBe(false)

			// Test third yield
			const result2 = await executeGeneratorToIndex(
				testGenerator,
				attributes,
				2
			)
			expect(result2.value?.type).toBe("SEND_SMS")
			expect(result2.done).toBe(false)
		})

		test("should handle attribute changes between steps", async () => {
			const attributes: TestUserAttributes[] = [
				{ name: "Alice", email: "alice@test.com" },
				{ name: "Bob", email: "bob@test.com" },
				{ name: "Charlie", email: "charlie@test.com" }
			]

			const nameCheckGenerator = String.raw`
        function* (ctx, rt) {
          yield rt.sendEmail('test');
          yield rt.sendEmail('test');
        }
      `

			const result0 = await executeGeneratorToIndex(
				nameCheckGenerator,
				attributes,
				0
			)
			expect(result0.done).toBe(false)
			expect(result0.attributes!.name).toBe("Alice")
			expect(result0.attributes!.email).toBe("alice@test.com")
			const result0Value = result0.value! as {
				type: "SEND_EMAIL"
				templateId: string
			}
			expect(result0Value.type).toBe("SEND_EMAIL")
			expect(result0Value.templateId).toBe("test")

			const result1 = await executeGeneratorToIndex(
				nameCheckGenerator,
				attributes,
				1
			)
			expect(result1.done).toBe(false)
			expect(result1.attributes!.name).toBe("Bob")
			expect(result1.attributes!.email).toBe("bob@test.com")
			const result1Value = result1.value! as {
				type: "SEND_EMAIL"
				templateId: string
			}
			expect(result1Value.type).toBe("SEND_EMAIL")
			expect(result1Value.templateId).toBe("test")

			const result2 = await executeGeneratorToIndex(
				nameCheckGenerator,
				attributes,
				2
			)
			expect(result2.done).toBe(true)
			expect(result2.attributes!.name).toBe("Charlie")
			expect(result2.attributes!.email).toBe("charlie@test.com")
			expect(result2.value).toBeUndefined()
		})

		test("should handle generator completion", async () => {
			const shortGenerator = String.raw`
        function* (ctx, rt) {
          yield rt.sendEmail({
            subject: 'Only one',
            template: 'test'
          });
        }
      `

			const attributes: TestUserAttributes[] = [
				{ name: "Test", email: "test@test.com" }
			]

			const result = await executeGeneratorToIndex(
				shortGenerator,
				attributes,
				0
			)
			expect(result.value?.type).toBe("SEND_EMAIL")
			expect(result.done).toBe(false)
		})

		test("should handle errors in generator", async () => {
			const errorGenerator = String.raw`
        function* (ctx, rt) {
          throw new Error('Test error');
        }
      `

			const attributes: TestUserAttributes[] = [
				{ name: "Test", email: "test@test.com" }
			]

			await expect(
				executeGeneratorToIndex(errorGenerator, attributes, 0)
			).rejects.toThrow("Test error")
		})
	})
})

describe("evalSandboxedWithAttributes", () => {
	test("should evaluate code with provided attributes", async () => {
		const attributes = {
			name: "Test User",
			email: "test@test.com",
			website: "https://example.com"
		}

		// Test simple string interpolation
		const result1 = await evalSandboxedWithUser(
			'attributes => attributes.name + " has email " + attributes.email',
			attributes
		)
		expect(result1).toBe("Test User has email test@test.com")

		// Test template literal
		const result2 = await evalSandboxedWithUser(
			"attributes => `${attributes.name} (${attributes.email})`",
			attributes
		)
		expect(result2).toBe("Test User (test@test.com)")

		// Test conditional logic
		const result3 = await evalSandboxedWithUser(
			'attributes => attributes.website ? "Has website: " + attributes.website : "No website"',
			attributes
		)
		expect(result3).toBe("Has website: https://example.com")
	})

	test("should handle missing attributes safely", async () => {
		const attributes = {
			name: "Test User",
			email: "test@test.com"
		}

		const result = await evalSandboxedWithUser(
			'attributes => attributes.website ? "Has website: " + attributes.website : "No website"',
			attributes
		)
		expect(result).toBe("No website")
	})

	test("should handle complex expressions", async () => {
		const attributes = {
			name: "Test User",
			email: "test@test.com",
			score: 85
		}

		const result = await evalSandboxedWithUser(
			`
      attributes => attributes.score >= 90 ? "A" :
      attributes.score >= 80 ? "B" :
      attributes.score >= 70 ? "C" : "D"
    `,
			attributes
		)
		expect(result).toBe("B")
	})
})

describe("renderTemplate", () => {
	test("should render template with user attributes and preamble", async () => {
		const attributes = {
			name: "Test User",
			email: "test@test.com"
		}

		const template = "<p>Hello <%= user.name %>!</p>"
		const preamble = 'const greeting = "Hello";'
		const result = await renderTemplate(template, preamble, attributes)
		expect(result).toBe("<p>Hello Test User!</p>")
	})

	test("should execute preamble code before rendering template", async () => {
		const attributes = {
			name: "Test User",
			email: "test@test.com"
		}

		const template = "<p><%= greeting %> <%= user.name %>!</p>"
		const preamble = 'const greeting = "Hi";'
		const result = await renderTemplate(template, preamble, attributes)
		expect(result).toBe("<p>Hi Test User!</p>")
	})

	test("should handle complex preamble code", async () => {
		const attributes = {
			name: "John Doe",
			purchases: [
				{ item: "Book", price: 10 },
				{ item: "Pen", price: 2 }
			]
		}

		const template = `
      <h1>Receipt for <%= user.name %></h1>
      <ul>
        <% user.purchases.forEach(function(purchase) { %>
          <li><%= purchase.item %>: $<%= purchase.price %></li>
        <% }); %>
      </ul>
      <p>Total: $<%= total %></p>
    `.trim()

		const preamble = `
      let total = 0;
      user.purchases.forEach(function(purchase) {
        total += purchase.price;
      });
    `

		const result = await renderTemplate(template, preamble, attributes)
		expect(result).toContain("<h1>Receipt for John Doe</h1>")
		expect(result).toContain("<li>Book: $10</li>")
		expect(result).toContain("<li>Pen: $2</li>")
		expect(result).toContain("<p>Total: $12</p>")
	})

	test("should handle missing preamble gracefully", async () => {
		const attributes = {
			name: "Test User"
		}

		const template = "<p>Hello <%= user.name %>!</p>"
		const result = await renderTemplate(template, "", attributes)
		expect(result).toBe("<p>Hello Test User!</p>")
	})
})

describe("renderTransaction", () => {
	test("should render template with user and event data", async () => {
		const attributes = {
			name: "Alice",
			email: "alice@example.com"
		}

		const event = {
			product: "Laptop",
			price: 1200
		}

		const template = `<p><%= user.name %> purchased a <%= event.product %> for $<%= event.price %>.</p>`
		const preamble = ""
		const result = await renderTransaction(
			template,
			preamble,
			attributes,
			event
		)
		expect(result).toBe("<p>Alice purchased a Laptop for $1200.</p>")
	})

	test("should execute preamble code with user and event data", async () => {
		const attributes = {
			name: "Bob",
			email: "bob@example.com"
		}

		const event = {
			items: [
				{ name: "Book", price: 10 },
				{ name: "Pen", price: 2 }
			]
		}

		const template = `
      <h1>Order Summary for <%= user.name %></h1>
      <ul>
        <% event.items.forEach(function(item) { %>
          <li><%= item.name %>: $<%= item.price %></li>
        <% }); %>
      </ul>
      <p>Total: $<%= total %></p>
    `.trim()

		const preamble = `
      let total = 0;
      event.items.forEach(function(item) {
        total += item.price;
      });
    `

		const result = await renderTransaction(
			template,
			preamble,
			attributes,
			event
		)
		expect(result).toContain("<h1>Order Summary for Bob</h1>")
		expect(result).toContain("<li>Book: $10</li>")
		expect(result).toContain("<li>Pen: $2</li>")
		expect(result).toContain("<p>Total: $12</p>")
	})

	test("should handle complex logic in preamble", async () => {
		const attributes = {
			name: "Charlie"
		}

		const event = {
			scores: [80, 70, 90]
		}

		const template = `<p><%= user.name %>'s average score is <%= average %>.</p>`
		const preamble = `
      let total = 0;
      event.scores.forEach(score => total += score);
      let average = total / event.scores.length;
    `

		const result = await renderTransaction(
			template,
			preamble,
			attributes,
			event
		)
		expect(result).toBe("<p>Charlie's average score is 80.</p>")
	})

	test("should handle errors in preamble gracefully", async () => {
		const attributes = {
			name: "Dana"
		}

		const event = {
			value: 100
		}

		const template = `<p>The result is <%= result %>.</p>`
		const preamble = `
      // Intentional error
      let result = event.value + nonexistentVariable;
    `

		await expect(
			renderTransaction(template, preamble, attributes, event)
		).rejects.toThrow()
	})

	test("should handle missing event data gracefully", async () => {
		const attributes = {
			name: "Eve"
		}

		const event = {}

		const template = `<p><%= user.name %> did something.</p>`
		const preamble = ""
		const result = await renderTransaction(
			template,
			preamble,
			attributes,
			event
		)
		expect(result).toBe("<p>Eve did something.</p>")
	})
})
