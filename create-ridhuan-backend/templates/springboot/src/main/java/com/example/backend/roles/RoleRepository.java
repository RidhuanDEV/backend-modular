package com.example.backend.roles;

import java.util.*;
import org.springframework.data.jpa.repository.*;

public interface RoleRepository extends JpaRepository<RoleEntity, UUID> {
  Optional<RoleEntity> findByName(String value);
}
