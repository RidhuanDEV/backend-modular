# Dependency ledger
Verified 2026-10-03 using publisher documentation and Maven Central published POMs; final resolved graph is obtained during full build. No snapshots.
| Dependency | Publisher/license | Role/compatibility evidence |
| --- | --- | --- |
| Spring Boot4.1.1 BOM | Spring/Broadcom, Apache2 | [requirements](https://docs.spring.io/spring-boot/system-requirements.html): Java17-26; Java25 selected |
| Spring MVC/Security/JPA/Redis/Mail/Actuator/OTel | Spring, Apache2 | Official Boot starters and BOM; one tracing owner |
| Nimbus JOSE JWT | Connect2id, Apache2 | Spring Resource Server supported encoder/decoder, HS256 allowlist |
| Flyway/core/PostgreSQL/MySQL modules | Redgate, Apache2 core | BOM versions; official JDBC drivers and provider modules |
| PostgreSQL JDBC / MySQL ConnectorJ | PostgreSQL BSD / Oracle GPL2+FOSS exception | BOM JDBC; native provider migration histories |
| springdoc3.1.1 | springdoc community, Apache2 | [Boot4 branch](https://springdoc.org/), published release uses Jackson3 |
| dotenv-java3.2.0 | cdimascio, Apache2 | [upstream](https://github.com/cdimascio/dotenv-java), real dotenv parser |
| AWS SDK v2 2.38.4 BOM/S3 | AWS, Apache2 | Official S3 client, bounded synchronous HTTP transport |
| Tika core3.2.3 | Apache, Apache2 | Maintained content detection without full parsers |
| Caffeine | Ben Manes, Apache2 | Boot BOM, bounded local quota windows |
| JSpecify1.0.0 | JSpecify, Apache2 | Explicit nullable boundaries and package defaults |
| JUnit/SecurityTest/Testcontainers | official projects, EPL2/Apache2/MIT | Boot BOM native testing |
| Spotless3.0.0/google-java-format1.30.0 | DiffPlug/Google, Apache2 | Maintained pinned formatter |
| Maven Wrapper3.3.4/Maven3.9.16 | Apache, Apache2 | Initializr official scripts; distribution SHA256 pinned after SHA512 verification from Maven Central |
| Temurin25.0.4.1 | Eclipse Adoptium, GPL2+Classpath | Official checksum verified JDK; Docker JDK/JRE image index digests pinned |

NullAway0.14.2 (Uber/MIT), ErrorProne2.50.0 (Google/Apache2) enforce JSpecify nullness at compilation. Compiler -Werror rejects raw/unchecked generic use. ErrorProne check selection is NullAway only; see official ErrorProne installation/JSpecify NullAway documentation.
Optional development MinIO/mc are built from upstream immutable revisions9e49d5e/7394ce0d (AGPL3) using scripts/minio.Dockerfile; registry images are unavailable at verification time.

Security overrides after OSV audit: Tomcat11.0.26, Jackson3.1.7 and Jackson2.21.7 BOMs, staying on the Boot4.1.1 patch lines. Published artifacts verified against Maven Central; see [Tomcat security](https://tomcat.apache.org/security-11.html), [Jackson3.1.7](https://github.com/FasterXML/jackson/wiki/Jackson-Release-3.1.7), [Jackson2.21.7](https://github.com/FasterXML/jackson/wiki/Jackson-Release-2.21.7). Dependency OSV and license audits are collecting gates in scripts/verify-dependencies.ps1.
Dotenv3.2.0 quoting adapter canonicalizes CLI-generated quoted scalars using Jackson; the pinned public DotenvReader/DotenvParser signatures were verified from the published JAR and upstream source. Invalid entries are redacted, including parser causes.

SSE uses the pinned Tomcat HTTP/1.1 NIO implementation through published native APIs: [AbstractEndpoint.getConnections](https://tomcat.apache.org/tomcat-11.0-doc/api/org/apache/tomcat/util/net/AbstractEndpoint.html), [SocketWrapperBase connection/lock/readiness](https://tomcat.apache.org/tomcat-11.0-doc/api/org/apache/tomcat/util/net/SocketWrapperBase.html) and ServletConnection IDs. A typed Http11NioProtocol subclass exposes its protected endpoint; no reflection or guessed peer address is used. The [11.0.26 NioEndpoint source](https://github.com/apache/tomcat/blob/11.0.26/java/org/apache/tomcat/util/net/NioEndpoint.java) confirms isReadyForRead performs a nonblocking read, preserves buffered bytes, and throws EOFException when input ends. AbstractProtocol.longPoll does not register read interest for async processors; heartbeat write failure alone does not reliably detect proxy half-close. The endpoint lock is acquired with tryLock and released in finally.
