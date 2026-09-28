package httpapi

func (s *Server) mount() {
	s.mountSystem()
	s.mountAuth()
	s.mountUsers()
	s.mountRoles()
	s.mountPermissions()
	s.mountUploads()
}
