import React from "react"
import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Html,
	Preview,
	Text,
	Tailwind
} from "@react-email/components"
import type { MyUserAttributes } from "../segflow.config"

export const PurchaseConfirmationEmailTemplate: React.FunctionComponent<{
	user: MyUserAttributes
	event: Record<string, any>
}> = ({ user, event }) => {
	const previewText = `We miss you! Special offer inside`

	return (
		<Html>
			<Head />
			<Preview>{previewText}</Preview>
			<Tailwind>
				<Body className="bg-white my-auto mx-auto font-sans px-2">
					<Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px]">
						<Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
							Thank you for your purchase!
						</Heading>
						<Text className="text-black text-[14px] leading-[24px]">
							Hello {user.name},
						</Text>
						<Text className="text-black text-[14px] leading-[24px]">
							Your order {event.orderId} has been confirmed.
						</Text>
						<Button
							className="bg-[#000000] rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
							href={`https://your-platform.com/order/${event.orderId}`}
						>
							View Order
						</Button>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	)
}

export default PurchaseConfirmationEmailTemplate
