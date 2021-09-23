// This is the row ID used in the client, but it's helpful to have available in some common code
// as well, which is why it's declared in app/common. Note that for data actions and stored data,
// 'new' is not used.
export type UIRowId = number | 'new';
