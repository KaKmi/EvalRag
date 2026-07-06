import { BadRequestException, Body, Controller, Get, Patch, Req } from "@nestjs/common";
import {
  ChangeOwnPasswordRequestSchema,
  type ChangeOwnPasswordResponse,
  type UserProfile,
} from "@codecrush/contracts";
import type { AuthenticatedUser } from "../../platform/security/authenticated-user";
import { UsersService } from "./users.service";

type AuthedRequest = { user: AuthenticatedUser };

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  async me(@Req() req: AuthedRequest): Promise<UserProfile> {
    return await this.usersService.getProfile(req.user.id);
  }

  @Patch("me/password")
  async changePassword(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<ChangeOwnPasswordResponse> {
    const parsed = ChangeOwnPasswordRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    await this.usersService.changeOwnPassword(
      req.user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    return { status: "ok" };
  }
}
