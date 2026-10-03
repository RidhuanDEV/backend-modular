package com.example.backend.uploads;

import com.example.backend.platform.endpoint.*;
import com.example.backend.platform.http.Api;
import com.example.backend.platform.security.Access;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/upload")
public class UploadController {
  private final UploadService service;
  private final Access access;

  public UploadController(UploadService service, Access access) {
    this.service = service;
    this.access = access;
  }

  @PostMapping(consumes = "multipart/form-data")
  @ResponseStatus(HttpStatus.CREATED)
  @EndpointPolicy(EndpointId.UPLOAD_CREATE)
  public Api.Success<UploadDto> upload(@RequestPart("file") MultipartFile file)
      throws java.io.IOException {
    return Api.Success.of(service.upload(file, access.actor()));
  }

  @GetMapping(value = "/{id}", produces = "application/json")
  @EndpointPolicy(EndpointId.UPLOAD_GET)
  public Api.Success<UploadDto> get(@PathVariable UUID id) {
    return Api.Success.of(service.get(id));
  }

  @GetMapping(value = "/{id}", produces = "application/octet-stream")
  @EndpointPolicy(EndpointId.UPLOAD_GET)
  public void download(@PathVariable UUID id, HttpServletResponse response)
      throws java.io.IOException {
    var dto = service.get(id);
    response.setContentType("application/octet-stream");
    response.setContentLengthLong(dto.size());
    response.setHeader(
        "Content-Disposition",
        ContentDisposition.attachment()
            .filename(dto.originalName(), java.nio.charset.StandardCharsets.UTF_8)
            .build()
            .toString());
    service.download(id, response.getOutputStream());
  }
}
