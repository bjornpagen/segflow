import type { BaseUserAttributes, SegflowConfig } from "../shared/types"
import { parse } from "@babel/parser"
import traverse, { type NodePath } from "@babel/traverse"
import * as t from "@babel/types"

/**
 * Validates the SegflowConfig to ensure campaigns reference existing segments and templates.
 * @param config The SegflowConfig object to validate.
 * @returns An object indicating success or an error message.
 */
export function validateConfig<T extends BaseUserAttributes>(
	config: SegflowConfig<T>
): { success: boolean } | { errors: string[] } {
	const templateKeys = Object.keys(config.templates)
	const segmentKeys = Object.keys(config.segments)
	const errors: string[] = []

	for (const [campaignName, campaignConfig] of Object.entries(
		config.campaigns
	)) {
		// Validate segments in the campaign
		const invalidSegments = campaignConfig.segments.filter(
			(segment) => !segmentKeys.includes(segment)
		)
		if (invalidSegments.length > 0) {
			errors.push(
				`Error in campaign "${campaignName}": The following segments do not exist in config.segments: ${invalidSegments.join(", ")}.`
			)
		}

		// Validate excludeSegments in the campaign
		if (campaignConfig.excludeSegments) {
			const invalidExcludeSegments = campaignConfig.excludeSegments.filter(
				(segment) => !segmentKeys.includes(segment)
			)
			if (invalidExcludeSegments.length > 0) {
				errors.push(
					`Error in campaign "${campaignName}": The following excludeSegments do not exist in config.segments: ${invalidExcludeSegments.join(", ")}.`
				)
			}
		}

		// Obtain the source code of the flow function
		const flowFunction = campaignConfig.flow
		let flowCode = flowFunction.toString()
		flowCode = `const flow = ${flowCode}`
		// Parse the flow function code using Babel
		const ast = parse(flowCode)

		// Extract the runtime parameter name
		let runtimeParamName: string | null = null
		traverse(ast, {
			FunctionExpression(path: NodePath<t.FunctionExpression>) {
				const params = path.node.params
				if (params.length >= 2) {
					const runtimeParam = params[1]
					if (t.isIdentifier(runtimeParam)) {
						runtimeParamName = runtimeParam.name
					}
				}
				// Stop traversal once we have the parameter name
				path.stop()
			}
		})

		if (!runtimeParamName) {
			errors.push(
				`Error in campaign "${campaignName}": Unable to determine the runtime parameter name in flow function.`
			)
			continue
		}

		// Traverse the AST to find calls to runtime.sendEmail(...)
		traverse(ast, {
			CallExpression(path: NodePath<t.CallExpression>) {
				const callee = path.get("callee")

				// Check if the call is <runtimeParamName>.sendEmail(...)
				if (
					callee.isMemberExpression() &&
					callee.get("object").isIdentifier({ name: runtimeParamName }) &&
					callee.get("property").isIdentifier({ name: "sendEmail" })
				) {
					const args = path.get("arguments")

					if (args.length !== 1) {
						errors.push(
							`Error in campaign "${campaignName}": ${runtimeParamName}.sendEmail should have exactly one argument.`
						)
						return
					}

					const arg = args[0]

					// Check if the argument is a string literal
					if (!arg.isStringLiteral()) {
						errors.push(
							`Error in campaign "${campaignName}": The template argument in ${runtimeParamName}.sendEmail should be a string literal.`
						)
						return
					} else {
						const templateName = arg.node.value

						// Check if the template name exists
						if (!templateKeys.includes(templateName)) {
							errors.push(
								`Error in campaign "${campaignName}": Template "${templateName}" does not exist in templates.`
							)
							return
						}
					}
				}
			}
		})
	}

	if (errors.length > 0) {
		return { errors }
	} else {
		return { success: true }
	}
}
