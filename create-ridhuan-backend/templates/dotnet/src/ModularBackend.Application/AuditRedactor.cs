using System.Text.Json.Nodes;

namespace ModularBackend.Application;

public static class AuditRedactor
{
    public static string? Redact(string? json)
    {
        if (json is null)
            return null;
        var node = JsonNode.Parse(json);
        Visit(node);
        return node?.ToJsonString();
    }

    private static void Visit(JsonNode? node)
    {
        if (node is JsonObject obj)
            foreach (var (key, value) in obj.ToArray())
                if (
                    new[]
                    {
                        "password",
                        "hash",
                        "token",
                        "secret",
                        "credential",
                        "bytes",
                        "accesskey",
                    }.Any(s => key.Contains(s, StringComparison.OrdinalIgnoreCase))
                )
                    obj.Remove(key);
                else
                    Visit(value);
        else if (node is JsonArray array)
            foreach (var value in array)
                Visit(value);
    }
}
