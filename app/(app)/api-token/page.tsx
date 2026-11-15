import { ApiTokenPanel } from "@/components/app/api-token-panel";
import { PageHeader } from "@/components/app/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const instant = false;

export default function ApiTokenPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Developer"
        title="API token"
        description="Create a short-lived bearer token to call the Ryld API yourself."
      />

      <div className="max-w-2xl space-y-4">
        <ApiTokenPanel />

        <Card>
          <CardHeader>
            <CardTitle>Using the token</CardTitle>
            <CardDescription>
              Send it as a Bearer header. It is only valid for the API service.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="border-border bg-muted/40 overflow-x-auto rounded-lg border p-3 font-mono text-xs leading-relaxed">
              <code>{`curl "$RYLD_API_URL/connections/" \\
  -H "Authorization: Bearer $RYLD_TOKEN"`}</code>
            </pre>
            <p className="text-muted-foreground text-xs">
              Replace the variables with your API base URL and the token above.
              Tokens are short-lived, so generate a new one when this one
              expires. There is no refresh token.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
