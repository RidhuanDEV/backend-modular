package com.example.backend.permissions;

import java.util.*;
import org.springframework.data.jpa.repository.*;

public interface PermissionRepository extends JpaRepository<PermissionEntity, UUID> {
  Optional<PermissionEntity> findByName(String value);
}
