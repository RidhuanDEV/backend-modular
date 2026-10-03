export type TemplateId = "express-typescript" | "nestjs" | "golang" | "dotnet" | "fastapi" | "springboot" | "laravel";
export type DatabaseProvider = "postgresql" | "mysql";
export type UploadStorageType = "local" | "s3";
export type SetupMode = "manual" | "docker";

export interface PromptOption<T> {
  readonly label: string;
  readonly value: T;
  readonly hint?: string;
  readonly activeColor?: string;
  readonly inactiveColor?: string;
}
export interface CliArguments {
  readonly database?: DatabaseProvider;
  readonly projectName?: string;
  readonly template?: TemplateId;
  readonly port?: number;
  readonly mode?: SetupMode;
  readonly dbHost?: string;
  readonly dbPort?: number;
  readonly dbName?: string;
  readonly dbUser?: string;
  readonly redis?: boolean;
  readonly storage?: UploadStorageType;
  readonly goModule?: string;
  readonly javaPackage?: string;
  readonly s3Endpoint?: string;
  readonly s3DockerEndpoint?: string;
  readonly s3Region?: string;
  readonly s3Bucket?: string;
  readonly s3AccessKey?: string;
  readonly yes: boolean;
  readonly noInstall: boolean;
  readonly help: boolean;
  readonly version: boolean;
}
export interface ProjectAnswers {
  readonly databaseProvider: DatabaseProvider;
  readonly targetDirectory: string;
  readonly projectName: string;
  readonly packageName: string;
  readonly namespace: string;
  readonly javaPackage: string;
  readonly deploymentName: string;
  readonly templateId: TemplateId;
  readonly mode: SetupMode;
  readonly appPort: number;
  readonly dbHost: string;
  readonly dbPort: number;
  readonly dbName: string;
  readonly dbUser: string;
  readonly dbPassword: string;
  readonly enableRedis: boolean;
  readonly uploadStorage: UploadStorageType;
  readonly s3Endpoint: string;
  readonly s3DockerEndpoint: string;
  readonly s3Region: string;
  readonly s3Bucket: string;
  readonly s3AccessKey: string;
  readonly s3SecretKey: string;
  readonly goModulePath?: string;
}
export interface RuntimeRequirements {
  readonly java?: string;
  readonly maven?: string;
  readonly php?: string;
  readonly composer?: string;
  readonly phpExtensions?: readonly string[];
  readonly python?: string;
  readonly uv?: string;
  readonly node?: string;
  readonly go?: string;
  readonly dotnet?: string;
}
export interface TemplateManifest {
  readonly schemaVersion: 1 | 2;
  readonly databaseProviders: readonly DatabaseProvider[];
  readonly id: TemplateId;
  readonly source: { readonly repository: string; readonly commit: string | null; readonly dirty: boolean };
  readonly requirements: RuntimeRequirements;
  readonly identity: string;
  readonly files: Readonly<Record<string, string>>;
}
export interface TemplateDescriptor {
  readonly id: TemplateId;
  readonly label: string;
  readonly hint: string;
  readonly defaultPort: number;
  readonly containerPort: number;
  readonly dbPort: number;
  readonly redisPort: number;
  readonly storagePort: number;
  readonly storageHost: string;
  readonly storageProfile: string;
  readonly composeFile: string;
  readonly httpService?: string;
  readonly applicationService?: string;
  readonly workerService?: string;
  readonly install: { readonly command: "npm" | "go" | "dotnet" | "uv" | "mvnw" | "composer"; readonly args: readonly string[] };
}
export interface ScaffoldResult {
  readonly projectDirectory: string;
  readonly templateId: TemplateId;
}
