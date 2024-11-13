import { type Node, parse, types as t } from "@babel/core"
import generate from "@babel/generator"

function transformAST(ast: Node) {
	function traverseNode(node: any) {
		if (!node || typeof node !== "object") return

		// Define the keys to process
		const keysToProcess = ["children", "href", "src", "alt"]

		// Check for ObjectProperty with key in keysToProcess
		if (
			t.isObjectProperty(node) &&
			((t.isIdentifier(node.key) && keysToProcess.includes(node.key.name)) ||
				(t.isStringLiteral(node.key) && keysToProcess.includes(node.key.value)))
		) {
			const keyName = t.isIdentifier(node.key) ? node.key.name : node.key.value
			const value = node.value

			if (keyName === "children") {
				// Existing logic for 'children'
				if (t.isArrayExpression(value)) {
					value.elements = value.elements.map((element: any) => {
						if (shouldWrapExpression(element)) {
							if (containsJSX(element)) {
								// Throw error if expression contains JSX
								throw new Error(
									`Expressions containing JSX in 'children' are not yet supported.`
								)
							} else {
								return t.stringLiteral(`<%= ${generate(element).code} %>`)
							}
						} else {
							traverseNode(element)
							return element
						}
					})
				} else {
					// Handle cases where 'children' is not an array
					if (shouldWrapExpression(value)) {
						if (containsJSX(value)) {
							// Throw error if expression contains JSX
							throw new Error(
								`Expressions containing JSX in 'children' are not yet supported.`
							)
						} else {
							node.value = t.stringLiteral(`<%= ${generate(value).code} %>`)
						}
					} else {
						traverseNode(value)
					}
				}
			} else {
				// For other attributes
				if (shouldWrapExpression(value)) {
					// Directly wrap the expression
					node.value = t.stringLiteral(`<%= ${generate(value).code} %>`)
				}
			}
		} else {
			// Recursively traverse child nodes
			for (const key in node) {
				const child = node[key]
				if (Array.isArray(child)) {
					child.forEach(traverseNode)
				} else {
					traverseNode(child)
				}
			}
		}
	}

	function shouldWrapExpression(node: any): boolean {
		return (
			t.isExpression(node) &&
			!t.isStringLiteral(node) &&
			!t.isNumericLiteral(node)
		)
	}

	function containsJSX(node: any): boolean {
		if (!node || typeof node !== "object") return false

		if (
			t.isJSXElement(node) ||
			t.isJSXFragment(node) ||
			isJSXDEVFunctionCall(node)
		) {
			return true
		}

		// Recursively check child nodes
		for (const key in node) {
			const child = node[key]
			if (Array.isArray(child)) {
				if (child.some((c: any) => containsJSX(c))) {
					return true
				}
			} else if (containsJSX(child)) {
				return true
			}
		}

		return false
	}

	// Helper function to identify jsxDEV calls
	function isJSXDEVFunctionCall(node: any): boolean {
		return (
			t.isCallExpression(node) &&
			t.isIdentifier(node.callee) &&
			node.callee.name.startsWith("jsxDEV")
		)
	}

	traverseNode(ast)
}

type TransformComponentComplexResult = {
	transformedComponent: string
	preamble: string
}

export function transformComponentComplex<T>(
	component: React.FunctionComponent<T>
): TransformComponentComplexResult {
	const stringifiedComponent = component.toString()
	const parsedResult = parse(stringifiedComponent)
	if (!parsedResult) throw new Error("Failed to parse component")
	const preamble = extractPreamble(parsedResult, true)
	transformAST(parsedResult)
	return { transformedComponent: generate(parsedResult).code, preamble }
}

function extractPreamble(ast: Node, strip = false): string {
	const statements: Array<Node> = []
	let returnStatementFound = false

	function traverseNode(node: any) {
		if (!node || typeof node !== "object" || returnStatementFound) return

		if (
			t.isArrowFunctionExpression(node) ||
			t.isFunctionDeclaration(node) ||
			t.isFunctionExpression(node)
		) {
			const body = node.body

			if (t.isBlockStatement(body)) {
				const bodyStatements = body.body
				let index = 0

				// Collect statements before the first return statement
				for (; index < bodyStatements.length; index++) {
					const stmt = bodyStatements[index]
					if (t.isReturnStatement(stmt)) {
						returnStatementFound = true
						break
					} else {
						statements.push(stmt)
					}
				}

				if (strip && statements.length > 0) {
					// Remove the preamble statements from the function body
					body.body = bodyStatements.slice(index)
				}
			}
		} else {
			// Recursively traverse child nodes
			for (const key in node) {
				const child = node[key]
				if (Array.isArray(child)) {
					child.forEach(traverseNode)
				} else {
					traverseNode(child)
				}
			}
		}
	}

	traverseNode(ast)

	// Generate code from collected statements
	return statements.map((stmt) => generate(stmt).code).join("\n")
}
