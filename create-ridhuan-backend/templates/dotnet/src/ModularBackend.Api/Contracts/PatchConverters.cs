using System.Text.Json;
using System.Text.Json.Serialization;

namespace ModularBackend.Api.Contracts;

public sealed class NonNullStringConverter : JsonConverter<string>
{
    public override bool HandleNull => true;

    public override string Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options
    ) =>
        reader.GetString()
        ?? throw new JsonException("Explicit null is not allowed; omit the field instead");

    public override void Write(
        Utf8JsonWriter writer,
        string value,
        JsonSerializerOptions options
    ) => writer.WriteStringValue(value);
}

public sealed class NonNullGuidConverter : JsonConverter<Guid?>
{
    public override bool HandleNull => true;

    public override Guid? Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options
    ) =>
        reader.TokenType == JsonTokenType.Null
            ? throw new JsonException("Explicit null is not allowed; omit the field instead")
            : reader.GetGuid();

    public override void Write(Utf8JsonWriter writer, Guid? value, JsonSerializerOptions options)
    {
        if (value is { } id)
            writer.WriteStringValue(id);
        else
            writer.WriteNullValue();
    }
}
