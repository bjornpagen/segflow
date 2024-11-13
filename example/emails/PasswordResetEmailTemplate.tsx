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

export const PasswordResetEmailTemplate: React.FunctionComponent<{
	user: MyUserAttributes
}> = ({ user }) => {
	const previewText = `Reset your password`

	return (
		<Html>
			<Head />
			<Preview>{previewText}</Preview>
			<Tailwind>
				<Body className="bg-white my-auto mx-auto font-sans px-2">
					<Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px]">
						<Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
							Reset Your Password
						</Heading>
						<Text className="text-black text-[14px] leading-[24px]">
							Hello {user.name},
						</Text>
						<Text className="text-black text-[14px] leading-[24px]">
							We received a request to reset your password. Click the button
							below to create a new password:
						</Text>
						<Section className="text-center mt-[32px] mb-[32px]">
							<Button
								className="bg-[#000000] rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
								href="https://your-platform.com/reset-password"
							>
								Reset Password
							</Button>
						</Section>
						<Text className="text-black text-[14px] leading-[24px]">
							If you didn't request this password reset, you can safely ignore
							this email.
						</Text>
						<Text className="text-[#666666] text-[12px] leading-[24px]">
							This link will expire in 24 hours.
						</Text>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	)
}

export default PasswordResetEmailTemplate
