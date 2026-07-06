import { BadRequestException, Body, Controller, HttpCode, Post } from "@nestjs/common";
import { LoginRequestSchema, type LoginResponse } from "@codecrush/contracts";
import { Public } from "../../platform/security/public.decorator";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @HttpCode(200)
  @Post("login")
  async login(@Body() body: unknown): Promise<LoginResponse> {
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return await this.authService.login(parsed.data.email, parsed.data.password);
  }
}
