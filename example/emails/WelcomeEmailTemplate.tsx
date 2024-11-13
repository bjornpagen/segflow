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

export const WelcomeEmailTemplate: React.FunctionComponent<{
	user: MyUserAttributes
}> = ({ user }) => {
	const previewText = `Welcome to our platform!`

	return (
		<Html>
			<Head />
			<Preview>{previewText}</Preview>
			<Tailwind>
				<Body className="bg-white my-auto mx-auto font-sans px-2">
					<Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px]">
						<Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
							Welcome to Our Platform!
						</Heading>
						<Text className="text-black text-[14px] leading-[24px]">
							Hello {user.name},
						</Text>
						<Text className="text-black text-[14px] leading-[24px]">
							We're excited to have you on board. Get started by exploring our
							features:
						</Text>
						<Section className="text-center mt-[32px] mb-[32px]">
							<Button
								className="bg-[#000000] rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
								href="https://your-platform.com/getting-started"
							>
								Get Started
							</Button>
						</Section>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	)
}

export default WelcomeEmailTemplate
