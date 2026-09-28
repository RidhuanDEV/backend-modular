using System.Globalization;
using System.Text.RegularExpressions;

namespace ModularBackend.Application;

public static partial class TimeContracts
{
    [GeneratedRegex(@"(Z|[+-]\d{2}:\d{2})$", RegexOptions.CultureInvariant)]
    private static partial Regex OffsetSuffix();
    public static DateTimeOffset ParseInstant(string value)
    {
        if (!value.Contains('T') || !OffsetSuffix().IsMatch(value) || !DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var result)) throw new ApiException(400, "Instant requires explicit offset or Z");
        return result.ToUniversalTime();
    }
    public static DateTimeOffset InZone(DateTimeOffset instant, string ianaZone)
    {
        if (!ianaZone.Contains('/') && ianaZone != "UTC") throw new ArgumentException("IANA timezone required", nameof(ianaZone));
        return TimeZoneInfo.ConvertTime(instant, TimeZoneInfo.FindSystemTimeZoneById(ianaZone));
    }
}
