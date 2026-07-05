import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ status: "ok", db: "up" }),
  }) as unknown as typeof fetch;
});

it("renders the shell brand", () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  expect(screen.getByText("CodeCrushBot")).toBeInTheDocument();
});
