import React from "react"
import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Html,
	Preview,
	Section,
	Text,
	Tailwind
} from "@react-email/components"
import type { MyUserAttributes } from "../segflow.config"

export const WinbackEmailTemplate: React.FunctionComponent<{
	user: MyUserAttributes
}> = ({ user }) => {
	const previewText = `We miss you! Special offer inside`

	return (
		<Html>
			<Head />
			<Preview>{previewText}</Preview>
			<Tailwind>
				<Body className="bg-white my-auto mx-auto font-sans px-2">
					<Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px]">
						<Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
							We Miss You!
						</Heading>
						<Text className="text-black text-[14px] leading-[24px]">
							Hello {user.name},
						</Text>
						<Text className="text-black text-[14px] leading-[24px]">
							We noticed you've been away for a while. We'd love to have you
							back! Here's a special offer just for you:
						</Text>
						<Text className="text-black text-[18px] font-bold text-center my-[16px]">
							SEG25
						</Text>
						<Text className="text-black text-[14px] leading-[24px]">
							Use this code to get 25% off your next purchase.
						</Text>
						<Section className="text-center mt-[32px] mb-[32px]">
							<Button
								className="bg-[#000000] rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
								href="https://your-platform.com/redeem-offer"
							>
								Redeem Offer
							</Button>
						</Section>
						<Text className="text-[#666666] text-[12px] leading-[24px]">
							This offer expires in 7 days. Terms and conditions apply.
						</Text>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	)
}

export default WinbackEmailTemplate
