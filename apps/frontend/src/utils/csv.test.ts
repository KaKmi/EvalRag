import { serializeCsv } from "./csv";

it("quotes RFC 4180 cells and neutralizes spreadsheet formulas when requested", () => {
  expect(
    serializeCsv([['问题,"双引号"\n下一行'], ['=HYPERLINK("https://example.com")'], ["+1+1"]], {
      alwaysQuote: true,
      neutralizeFormulas: true,
    }),
  ).toBe('"问题,""双引号""\n下一行"\n"\'=HYPERLINK(""https://example.com"")"\n"\'+1+1"');
});

it("preserves compact cells and supports CRLF", () => {
  expect(serializeCsv([["plain"], ['has,"quote"']], { lineEnding: "\r\n" })).toBe(
    'plain\r\n"has,""quote"""',
  );
});
