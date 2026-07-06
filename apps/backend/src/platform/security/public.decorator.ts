import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ROUTE_KEY = "codecrush:public_route";
export const Public = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
