import { getQuickJS, type QuickJSContext, Scope } from "quickjs-emscripten"
import type { BaseUserAttributes, RuntimeCommand } from "../shared/types.js"
import EJS_LIB from "./opt/ejs.min.js"

export function convertArbitraryObjectToJSValue(
	scope: Scope,
	vm: QuickJSContext,
	obj: any
) {
	switch (typeof obj) {
		case "string":
			return scope.manage(vm.newString(obj))
		case "number":
			return scope.manage(vm.newNumber(obj))
		case "boolean":
			return obj ? vm.true : vm.false
		case "object":
			if (obj === null) {
				return vm.null
			}
			let jsObj
			if (Array.isArray(obj)) {
				jsObj = scope.manage(vm.newArray())
			} else {
				jsObj = scope.manage(vm.newObject())
			}
			for (const [key, value] of Object.entries(obj)) {
				const jsKey = scope.manage(
					convertArbitraryObjectToJSValue(scope, vm, key)
				)
				const jsValue = convertArbitraryObjectToJSValue(scope, vm, value)
				vm.setProp(jsObj, jsKey, jsValue)
			}
			return jsObj
		case "undefined":
			return vm.undefined
		case "function":
			return scope.manage(vm.evalCode(obj.toString()).unwrap())
		default:
			throw new Error(`Unsupported type: ${typeof obj}`)
	}
}

function buildUserAttributes<T extends BaseUserAttributes>(
	scope: Scope,
	vm: QuickJSContext,
	attributes: T
) {
	return convertArbitraryObjectToJSValue(scope, vm, attributes)
}

export function buildRuntimeContext(scope: Scope, vm: QuickJSContext) {
	const runtime = scope.manage(vm.newObject())

	vm.setProp(
		runtime,
		scope.manage(vm.newString("sendEmail")),
		scope.manage(
			vm.newFunction("sendEmail", (arg) => {
				const ret = scope.manage(vm.newObject())
				vm.setProp(
					ret,
					scope.manage(vm.newString("type")),
					scope.manage(vm.newString("SEND_EMAIL"))
				)
				vm.setProp(ret, scope.manage(vm.newString("templateId")), arg)
				return ret
			})
		)
	)

	vm.setProp(
		runtime,
		scope.manage(vm.newString("sendSMS")),
		scope.manage(
			vm.newFunction("sendSMS", (arg) => {
				const ret = scope.manage(vm.newObject())
				vm.setProp(
					ret,
					scope.manage(vm.newString("type")),
					scope.manage(vm.newString("SEND_SMS"))
				)
				vm.setProp(ret, scope.manage(vm.newString("message")), arg)
				return ret
			})
		)
	)

	vm.setProp(
		runtime,
		scope.manage(vm.newString("wait")),
		scope.manage(
			vm.newFunction("wait", (arg) => {
				const ret = scope.manage(vm.newObject())
				vm.setProp(
					ret,
					scope.manage(vm.newString("type")),
					scope.manage(vm.newString("WAIT"))
				)
				vm.setProp(ret, scope.manage(vm.newString("duration")), arg)
				return ret
			})
		)
	)

	return runtime
}

export async function executeGeneratorToIndex<T extends BaseUserAttributes>(
	generatorCode: string,
	attributeStates: T[],
	targetIndex: number
) {
	const QuickJS = await getQuickJS()

	return await Scope.withScope((scope) => {
		const vm = scope.manage(QuickJS.newContext())
		let value: RuntimeCommand | undefined = undefined
		let attributes: T | undefined = undefined
		let done = false

		const runtime = scope.manage(buildRuntimeContext(scope, vm))
		const ctx = scope.manage(vm.newObject())

		// Set up initial global context
		vm.setProp(vm.global, "ctx", ctx)
		vm.setProp(vm.global, "rt", runtime)

		// Create and execute generator
		const shellString = `(${generatorCode})(ctx, rt);`
		const vmGenerator = scope.manage(vm.evalCode(shellString).unwrap())

		// Execute generator up to targetIndex, updating context each time
		for (let i = 0; i <= targetIndex; i++) {
			// Update context with new attributes
			const newAttributes = scope.manage(
				buildUserAttributes(scope, vm, attributeStates[i])
			)
			vm.setProp(ctx, "attributes", newAttributes)

			// Execute next step
			const jsResult = vm.dump(
				scope.manage(vm.callMethod(vmGenerator, "next", []).unwrap())
			)
			value = jsResult.value
			done = jsResult.done

			// Extract updated attributes from ctx
			const updatedAttributesHandle = scope.manage(
				vm.getProp(ctx, "attributes")
			)
			attributes = vm.dump(updatedAttributesHandle) as T // <-- Capture updated attributes

			if (done) {
				break
			}
		}

		return { value, done, attributes }
	})
}

/**
 * Evaluate arbitrary code in a sandboxed environment.
 * @param code - The code to evaluate.
 * @returns The result of the code evaluation.
 */
export async function evalSandboxed<T>(code: string): Promise<T> {
	const QuickJS = await getQuickJS()
	return await Scope.withScope((scope) => {
		const vm = scope.manage(QuickJS.newContext())
		const result = vm.evalCode(code).unwrap()
		return vm.dump(result).value as T
	})
}

export async function evalSandboxedWithUser<T extends BaseUserAttributes>(
	code: string,
	user: T
): Promise<string> {
	const QuickJS = await getQuickJS()
	return await Scope.withScope((scope) => {
		const vm = scope.manage(QuickJS.newContext())
		const userAttributesValue = scope.manage(
			buildUserAttributes(scope, vm, user)
		)
		vm.setProp(vm.global, "user", userAttributesValue)
		const result = scope.manage(vm.evalCode(`(${code})(user)`).unwrap())
		return vm.dump(result) as string
	})
}

export async function evalSandboxedWithUserAndEvent<
	T extends BaseUserAttributes
>(code: string, user: T, event: Record<string, any>): Promise<string> {
	const QuickJS = await getQuickJS()
	return await Scope.withScope((scope) => {
		const vm = scope.manage(QuickJS.newContext())
		const userAttributesValue = scope.manage(
			buildUserAttributes(scope, vm, user)
		)
		const eventAttributesValue = scope.manage(
			convertArbitraryObjectToJSValue(scope, vm, event)
		)
		vm.setProp(vm.global, "user", userAttributesValue)
		vm.setProp(vm.global, "event", eventAttributesValue)
		const result = scope.manage(vm.evalCode(`(${code})(user, event)`).unwrap())
		return vm.dump(result) as string
	})
}

async function renderWithContext(
	template: string,
	preamble: string,
	context: Record<string, Record<string, any>>
) {
	let ejs = EJS_LIB

	ejs += `(function() {`
	ejs += `let template = ejs.compile(payload);`
	ejs += `return template(object);`
	ejs += `})();`

	const QuickJS = await getQuickJS()
	return await Scope.withScope((scope) => {
		const vm = scope.manage(QuickJS.newContext())
		const payload = scope.manage(
			vm.newString(String.raw`<%${preamble || "()=>{}"}%>${template}`)
		)
		const objectHandle = scope.manage(vm.newObject())

		// Convert and set each context property
		for (const [key, value] of Object.entries(context)) {
			const convertedValue = scope.manage(
				convertArbitraryObjectToJSValue(scope, vm, value)
			)
			vm.setProp(objectHandle, key, convertedValue)
		}

		vm.setProp(vm.global, "object", objectHandle)
		vm.setProp(vm.global, "payload", payload)
		const result = vm.evalCode(ejs).unwrap()
		return vm.dump(result) as string
	})
}

export async function renderTemplate(
	template: string,
	preamble: string,
	user: Record<string, any>
) {
	return renderWithContext(template, preamble, { user })
}

export async function renderTransaction(
	template: string,
	preamble: string,
	user: Record<string, any>,
	event: Record<string, any>
) {
	return renderWithContext(template, preamble, { user, event })
}
