FROM mcr.microsoft.com/dotnet/sdk:10.0.401 AS build
WORKDIR /source
COPY . .
RUN dotnet restore --locked-mode
RUN dotnet publish src/ModularBackend.Api -c Release --no-restore -o /out/api
RUN dotnet publish tools/ModularBackend.Migrator -c Release --no-restore -o /out/migrator
RUN dotnet publish tools/ModularBackend.Seeder -c Release --no-restore -o /out/seeder
RUN dotnet publish tools/ModularBackend.Worker -c Release --no-restore -o /out/worker
RUN dotnet publish tools/ModularBackend.UploadCleanup -c Release --no-restore -o /out/cleanup

FROM mcr.microsoft.com/dotnet/aspnet:10.0.12 AS runtime
WORKDIR /app
COPY --from=build /out /app
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN mkdir /app/uploads && chown app:app /app/uploads
USER app
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "/app/api/ModularBackend.Api.dll"]
