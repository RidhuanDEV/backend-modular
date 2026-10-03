package com.example.backend.uploads;

import java.time.Instant;
import java.util.UUID;

public record UploadDto(
    UUID id, String originalName, String mimeType, long size, Instant createdAt) {}
