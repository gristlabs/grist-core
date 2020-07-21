export enum Permissions {
  NONE          = 0x0,
  // Note that the view permission bit provides view access ONLY to the resource to which
  // the aclRule belongs - it does not allow listing that resource's children. A resource's
  // children may only be listed if those children also have the view permission set.
  VIEW          = 0x1,
  UPDATE        = 0x2,
  ADD           = 0x4,
  // Note that the remove permission bit provides remove access to a resource AND all of
  // its child resources/ACLs
  REMOVE        = 0x8,
  SCHEMA_EDIT   = 0x10,
  ACL_EDIT      = 0x20,
  EDITOR        = VIEW | UPDATE | ADD | REMOVE,   // tslint:disable-line:no-bitwise
  ADMIN         = EDITOR | SCHEMA_EDIT,           // tslint:disable-line:no-bitwise
  OWNER         = ADMIN | ACL_EDIT,               // tslint:disable-line:no-bitwise

  // A virtual permission bit signifying that the general public has some access to
  // the resource via ACLs involving the everyone@ user.
  PUBLIC        = 0x80
}
