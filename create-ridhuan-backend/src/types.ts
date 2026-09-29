export type TemplateId = "express-typescript" | "golang" | "dotnet" | "nestjs";

export type UploadStorageType = "local" | "s3";

export interface TemplateChoice {
  readonly id: TemplateId;
  readonly name: string;
  readonly description: string;
  readonly defaultPort: number;
}

export interface PromptOption<T> {
  readonly label: string;
  readonly value: T;
  readonly hint?: string;
  readonly activeColor?: string;
  readonly inactiveColor?: string;
}

export interface CliArguments {
  readonly projectName?: string;
  readonly template?: TemplateId;
  readonly yes: boolean;
  readonly noInstall: boolean;
}

export interface ProjectAnswers {
  readonly targetDirectory: string;
  readonly projectName: string;
  readonly templateId: TemplateId;
  readonly appPort: number;
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

export interface ScaffoldResult {
  readonly projectDirectory: string;
  readonly templateId: TemplateId;
  readonly instructions: readonly string[];
}
