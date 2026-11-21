import { Form, InputRow, LabelRow, Section } from "@paperback/types";

const TOKEN_KEY = "readwise-token";

export function getToken(): string {
  return ((Application.getSecureState(TOKEN_KEY) as string | undefined) ?? "").trim();
}

export function setToken(value: string): void {
  Application.setSecureState(value.trim(), TOKEN_KEY);
}

export class ReadwiseSettingsForm extends Form {
  override getSections() {
    return [
      Section({ id: "token", header: "Readwise Access Token" }, [
        InputRow("token", {
          title: "Access Token",
          value: getToken(),
          isSecureEntry: true,
          onValueChange: Application.Selector(this as ReadwiseSettingsForm, "handleTokenChange"),
        }),
        LabelRow("help", {
          title: "Get it at readwise.io/access_token",
        }),
      ]),
    ];
  }

  async handleTokenChange(value: string): Promise<void> {
    setToken(value);
  }
}
