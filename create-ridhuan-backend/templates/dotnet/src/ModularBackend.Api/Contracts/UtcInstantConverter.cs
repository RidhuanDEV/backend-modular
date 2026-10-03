using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using ModularBackend.Application;

namespace ModularBackend.Api.Contracts;

public sealed class UtcInstantConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options
    ) =>
        TimeContracts.ParseInstant(
            reader.GetString() ?? throw new JsonException("Instant required")
        );

    public override void Write(
        Utf8JsonWriter writer,
        DateTimeOffset value,
        JsonSerializerOptions options
    ) =>
        writer.WriteStringValue(
            value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)
        );
}
