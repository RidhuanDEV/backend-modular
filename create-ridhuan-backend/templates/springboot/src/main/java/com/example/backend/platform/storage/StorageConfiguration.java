package com.example.backend.platform.storage;

import com.example.backend.config.Settings;
import com.example.backend.platform.observability.Telemetry;
import org.springframework.context.annotation.*;

@Configuration
public class StorageConfiguration {
  @Bean
  ObjectStorage objectStorage(Settings settings, Telemetry telemetry) throws java.io.IOException {
    ObjectStorage delegate =
        settings.storage() == Settings.Storage.s3
            ? new S3Storage(settings)
            : new LocalStorage(settings);
    return new ObservedStorage(delegate, telemetry);
  }
}
