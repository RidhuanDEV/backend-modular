namespace ModularBackend.Application;

// Absolute lifetime is fixed on the family at login; each rotated token lives at most IdleDays.
public sealed record RefreshSessionPolicy(int IdleDays, int AbsoluteDays);
