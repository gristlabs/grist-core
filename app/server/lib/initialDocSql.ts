/*** THIS FILE IS AUTO-GENERATED BY app/server/generateInitialDocSql.ts ***/

/* eslint-disable max-len */

export const GRIST_DOC_SQL = `
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS "_grist_DocInfo" (id INTEGER PRIMARY KEY, "docId" TEXT DEFAULT '', "peers" TEXT DEFAULT '', "basketId" TEXT DEFAULT '', "schemaVersion" INTEGER DEFAULT 0, "timezone" TEXT DEFAULT '', "documentSettings" TEXT DEFAULT '');
INSERT INTO _grist_DocInfo VALUES(1,'','','',44,'','');
CREATE TABLE IF NOT EXISTS "_grist_Tables" (id INTEGER PRIMARY KEY, "tableId" TEXT DEFAULT '', "primaryViewId" INTEGER DEFAULT 0, "summarySourceTable" INTEGER DEFAULT 0, "onDemand" BOOLEAN DEFAULT 0, "rawViewSectionRef" INTEGER DEFAULT 0, "recordCardViewSectionRef" INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_Tables_column" (id INTEGER PRIMARY KEY, "parentId" INTEGER DEFAULT 0, "parentPos" NUMERIC DEFAULT 1e999, "colId" TEXT DEFAULT '', "type" TEXT DEFAULT '', "widgetOptions" TEXT DEFAULT '', "isFormula" BOOLEAN DEFAULT 0, "formula" TEXT DEFAULT '', "label" TEXT DEFAULT '', "description" TEXT DEFAULT '', "untieColIdFromLabel" BOOLEAN DEFAULT 0, "summarySourceCol" INTEGER DEFAULT 0, "displayCol" INTEGER DEFAULT 0, "visibleCol" INTEGER DEFAULT 0, "rules" TEXT DEFAULT NULL, "reverseCol" INTEGER DEFAULT 0, "recalcWhen" INTEGER DEFAULT 0, "recalcDeps" TEXT DEFAULT NULL);
CREATE TABLE IF NOT EXISTS "_grist_Imports" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "origFileName" TEXT DEFAULT '', "parseFormula" TEXT DEFAULT '', "delimiter" TEXT DEFAULT '', "doublequote" BOOLEAN DEFAULT 0, "escapechar" TEXT DEFAULT '', "quotechar" TEXT DEFAULT '', "skipinitialspace" BOOLEAN DEFAULT 0, "encoding" TEXT DEFAULT '', "hasHeaders" BOOLEAN DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_External_database" (id INTEGER PRIMARY KEY, "host" TEXT DEFAULT '', "port" INTEGER DEFAULT 0, "username" TEXT DEFAULT '', "dialect" TEXT DEFAULT '', "database" TEXT DEFAULT '', "storage" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_External_table" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "databaseRef" INTEGER DEFAULT 0, "tableName" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_TableViews" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "viewRef" INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_TabItems" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "viewRef" INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_TabBar" (id INTEGER PRIMARY KEY, "viewRef" INTEGER DEFAULT 0, "tabPos" NUMERIC DEFAULT 1e999);
CREATE TABLE IF NOT EXISTS "_grist_Pages" (id INTEGER PRIMARY KEY, "viewRef" INTEGER DEFAULT 0, "indentation" INTEGER DEFAULT 0, "pagePos" NUMERIC DEFAULT 1e999, "shareRef" INTEGER DEFAULT 0, "options" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_Views" (id INTEGER PRIMARY KEY, "name" TEXT DEFAULT '', "type" TEXT DEFAULT '', "layoutSpec" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_Views_section" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "parentId" INTEGER DEFAULT 0, "parentKey" TEXT DEFAULT '', "title" TEXT DEFAULT '', "description" TEXT DEFAULT '', "defaultWidth" INTEGER DEFAULT 0, "borderWidth" INTEGER DEFAULT 0, "theme" TEXT DEFAULT '', "options" TEXT DEFAULT '', "chartType" TEXT DEFAULT '', "layoutSpec" TEXT DEFAULT '', "filterSpec" TEXT DEFAULT '', "sortColRefs" TEXT DEFAULT '', "linkSrcSectionRef" INTEGER DEFAULT 0, "linkSrcColRef" INTEGER DEFAULT 0, "linkTargetColRef" INTEGER DEFAULT 0, "embedId" TEXT DEFAULT '', "rules" TEXT DEFAULT NULL, "shareOptions" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_Views_section_field" (id INTEGER PRIMARY KEY, "parentId" INTEGER DEFAULT 0, "parentPos" NUMERIC DEFAULT 1e999, "colRef" INTEGER DEFAULT 0, "width" INTEGER DEFAULT 0, "widgetOptions" TEXT DEFAULT '', "displayCol" INTEGER DEFAULT 0, "visibleCol" INTEGER DEFAULT 0, "filter" TEXT DEFAULT '', "rules" TEXT DEFAULT NULL);
CREATE TABLE IF NOT EXISTS "_grist_Validations" (id INTEGER PRIMARY KEY, "formula" TEXT DEFAULT '', "name" TEXT DEFAULT '', "tableRef" INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_REPL_Hist" (id INTEGER PRIMARY KEY, "code" TEXT DEFAULT '', "outputText" TEXT DEFAULT '', "errorText" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_Attachments" (id INTEGER PRIMARY KEY, "fileIdent" TEXT DEFAULT '', "fileName" TEXT DEFAULT '', "fileType" TEXT DEFAULT '', "fileSize" INTEGER DEFAULT 0, "fileExt" TEXT DEFAULT '', "imageHeight" INTEGER DEFAULT 0, "imageWidth" INTEGER DEFAULT 0, "timeDeleted" DATETIME DEFAULT NULL, "timeUploaded" DATETIME DEFAULT NULL);
CREATE TABLE IF NOT EXISTS "_grist_Triggers" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "eventTypes" TEXT DEFAULT NULL, "isReadyColRef" INTEGER DEFAULT 0, "actions" TEXT DEFAULT '', "label" TEXT DEFAULT '', "memo" TEXT DEFAULT '', "enabled" BOOLEAN DEFAULT 0, "watchedColRefList" TEXT DEFAULT NULL, "options" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_ACLRules" (id INTEGER PRIMARY KEY, "resource" INTEGER DEFAULT 0, "permissions" INTEGER DEFAULT 0, "principals" TEXT DEFAULT '', "aclFormula" TEXT DEFAULT '', "aclColumn" INTEGER DEFAULT 0, "aclFormulaParsed" TEXT DEFAULT '', "permissionsText" TEXT DEFAULT '', "rulePos" NUMERIC DEFAULT 1e999, "userAttributes" TEXT DEFAULT '', "memo" TEXT DEFAULT '');
INSERT INTO _grist_ACLRules VALUES(1,1,63,'[1]','',0,'','',1e999,'','');
CREATE TABLE IF NOT EXISTS "_grist_ACLResources" (id INTEGER PRIMARY KEY, "tableId" TEXT DEFAULT '', "colIds" TEXT DEFAULT '');
INSERT INTO _grist_ACLResources VALUES(1,'','');
CREATE TABLE IF NOT EXISTS "_grist_ACLPrincipals" (id INTEGER PRIMARY KEY, "type" TEXT DEFAULT '', "userEmail" TEXT DEFAULT '', "userName" TEXT DEFAULT '', "groupName" TEXT DEFAULT '', "instanceId" TEXT DEFAULT '');
INSERT INTO _grist_ACLPrincipals VALUES(1,'group','','','Owners','');
INSERT INTO _grist_ACLPrincipals VALUES(2,'group','','','Admins','');
INSERT INTO _grist_ACLPrincipals VALUES(3,'group','','','Editors','');
INSERT INTO _grist_ACLPrincipals VALUES(4,'group','','','Viewers','');
CREATE TABLE IF NOT EXISTS "_grist_ACLMemberships" (id INTEGER PRIMARY KEY, "parent" INTEGER DEFAULT 0, "child" INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_Filters" (id INTEGER PRIMARY KEY, "viewSectionRef" INTEGER DEFAULT 0, "colRef" INTEGER DEFAULT 0, "filter" TEXT DEFAULT '', "pinned" BOOLEAN DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_Cells" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "colRef" INTEGER DEFAULT 0, "rowId" INTEGER DEFAULT 0, "root" BOOLEAN DEFAULT 0, "parentId" INTEGER DEFAULT 0, "type" INTEGER DEFAULT 0, "content" TEXT DEFAULT '', "userRef" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_Shares" (id INTEGER PRIMARY KEY, "linkId" TEXT DEFAULT '', "options" TEXT DEFAULT '', "label" TEXT DEFAULT '', "description" TEXT DEFAULT '');
CREATE INDEX _grist_Attachments_fileIdent ON _grist_Attachments(fileIdent);
COMMIT;
`;

export const GRIST_DOC_WITH_TABLE1_SQL = `
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS "_grist_DocInfo" (id INTEGER PRIMARY KEY, "docId" TEXT DEFAULT '', "peers" TEXT DEFAULT '', "basketId" TEXT DEFAULT '', "schemaVersion" INTEGER DEFAULT 0, "timezone" TEXT DEFAULT '', "documentSettings" TEXT DEFAULT '');
INSERT INTO _grist_DocInfo VALUES(1,'','','',44,'','');
CREATE TABLE IF NOT EXISTS "_grist_Tables" (id INTEGER PRIMARY KEY, "tableId" TEXT DEFAULT '', "primaryViewId" INTEGER DEFAULT 0, "summarySourceTable" INTEGER DEFAULT 0, "onDemand" BOOLEAN DEFAULT 0, "rawViewSectionRef" INTEGER DEFAULT 0, "recordCardViewSectionRef" INTEGER DEFAULT 0);
INSERT INTO _grist_Tables VALUES(1,'Table1',1,0,0,2,3);
CREATE TABLE IF NOT EXISTS "_grist_Tables_column" (id INTEGER PRIMARY KEY, "parentId" INTEGER DEFAULT 0, "parentPos" NUMERIC DEFAULT 1e999, "colId" TEXT DEFAULT '', "type" TEXT DEFAULT '', "widgetOptions" TEXT DEFAULT '', "isFormula" BOOLEAN DEFAULT 0, "formula" TEXT DEFAULT '', "label" TEXT DEFAULT '', "description" TEXT DEFAULT '', "untieColIdFromLabel" BOOLEAN DEFAULT 0, "summarySourceCol" INTEGER DEFAULT 0, "displayCol" INTEGER DEFAULT 0, "visibleCol" INTEGER DEFAULT 0, "rules" TEXT DEFAULT NULL, "reverseCol" INTEGER DEFAULT 0, "recalcWhen" INTEGER DEFAULT 0, "recalcDeps" TEXT DEFAULT NULL);
INSERT INTO _grist_Tables_column VALUES(1,1,1,'manualSort','ManualSortPos','',0,'','manualSort','',0,0,0,0,NULL,0,0,NULL);
INSERT INTO _grist_Tables_column VALUES(2,1,2,'A','Any','',1,'','A','',0,0,0,0,NULL,0,0,NULL);
INSERT INTO _grist_Tables_column VALUES(3,1,3,'B','Any','',1,'','B','',0,0,0,0,NULL,0,0,NULL);
INSERT INTO _grist_Tables_column VALUES(4,1,4,'C','Any','',1,'','C','',0,0,0,0,NULL,0,0,NULL);
CREATE TABLE IF NOT EXISTS "_grist_Imports" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "origFileName" TEXT DEFAULT '', "parseFormula" TEXT DEFAULT '', "delimiter" TEXT DEFAULT '', "doublequote" BOOLEAN DEFAULT 0, "escapechar" TEXT DEFAULT '', "quotechar" TEXT DEFAULT '', "skipinitialspace" BOOLEAN DEFAULT 0, "encoding" TEXT DEFAULT '', "hasHeaders" BOOLEAN DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_External_database" (id INTEGER PRIMARY KEY, "host" TEXT DEFAULT '', "port" INTEGER DEFAULT 0, "username" TEXT DEFAULT '', "dialect" TEXT DEFAULT '', "database" TEXT DEFAULT '', "storage" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_External_table" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "databaseRef" INTEGER DEFAULT 0, "tableName" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_TableViews" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "viewRef" INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_TabItems" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "viewRef" INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_TabBar" (id INTEGER PRIMARY KEY, "viewRef" INTEGER DEFAULT 0, "tabPos" NUMERIC DEFAULT 1e999);
INSERT INTO _grist_TabBar VALUES(1,1,1);
CREATE TABLE IF NOT EXISTS "_grist_Pages" (id INTEGER PRIMARY KEY, "viewRef" INTEGER DEFAULT 0, "indentation" INTEGER DEFAULT 0, "pagePos" NUMERIC DEFAULT 1e999, "shareRef" INTEGER DEFAULT 0, "options" TEXT DEFAULT '');
INSERT INTO _grist_Pages VALUES(1,1,0,1,0,'');
CREATE TABLE IF NOT EXISTS "_grist_Views" (id INTEGER PRIMARY KEY, "name" TEXT DEFAULT '', "type" TEXT DEFAULT '', "layoutSpec" TEXT DEFAULT '');
INSERT INTO _grist_Views VALUES(1,'Table1','raw_data','');
CREATE TABLE IF NOT EXISTS "_grist_Views_section" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "parentId" INTEGER DEFAULT 0, "parentKey" TEXT DEFAULT '', "title" TEXT DEFAULT '', "description" TEXT DEFAULT '', "defaultWidth" INTEGER DEFAULT 0, "borderWidth" INTEGER DEFAULT 0, "theme" TEXT DEFAULT '', "options" TEXT DEFAULT '', "chartType" TEXT DEFAULT '', "layoutSpec" TEXT DEFAULT '', "filterSpec" TEXT DEFAULT '', "sortColRefs" TEXT DEFAULT '', "linkSrcSectionRef" INTEGER DEFAULT 0, "linkSrcColRef" INTEGER DEFAULT 0, "linkTargetColRef" INTEGER DEFAULT 0, "embedId" TEXT DEFAULT '', "rules" TEXT DEFAULT NULL, "shareOptions" TEXT DEFAULT '');
INSERT INTO _grist_Views_section VALUES(1,1,1,'record','','',100,1,'','','','','','[]',0,0,0,'',NULL,'');
INSERT INTO _grist_Views_section VALUES(2,1,0,'record','','',100,1,'','','','','','',0,0,0,'',NULL,'');
INSERT INTO _grist_Views_section VALUES(3,1,0,'single','','',100,1,'','','','','','',0,0,0,'',NULL,'');
CREATE TABLE IF NOT EXISTS "_grist_Views_section_field" (id INTEGER PRIMARY KEY, "parentId" INTEGER DEFAULT 0, "parentPos" NUMERIC DEFAULT 1e999, "colRef" INTEGER DEFAULT 0, "width" INTEGER DEFAULT 0, "widgetOptions" TEXT DEFAULT '', "displayCol" INTEGER DEFAULT 0, "visibleCol" INTEGER DEFAULT 0, "filter" TEXT DEFAULT '', "rules" TEXT DEFAULT NULL);
INSERT INTO _grist_Views_section_field VALUES(1,1,1,2,0,'',0,0,'',NULL);
INSERT INTO _grist_Views_section_field VALUES(2,1,2,3,0,'',0,0,'',NULL);
INSERT INTO _grist_Views_section_field VALUES(3,1,3,4,0,'',0,0,'',NULL);
INSERT INTO _grist_Views_section_field VALUES(4,2,4,2,0,'',0,0,'',NULL);
INSERT INTO _grist_Views_section_field VALUES(5,2,5,3,0,'',0,0,'',NULL);
INSERT INTO _grist_Views_section_field VALUES(6,2,6,4,0,'',0,0,'',NULL);
INSERT INTO _grist_Views_section_field VALUES(7,3,7,2,0,'',0,0,'',NULL);
INSERT INTO _grist_Views_section_field VALUES(8,3,8,3,0,'',0,0,'',NULL);
INSERT INTO _grist_Views_section_field VALUES(9,3,9,4,0,'',0,0,'',NULL);
CREATE TABLE IF NOT EXISTS "_grist_Validations" (id INTEGER PRIMARY KEY, "formula" TEXT DEFAULT '', "name" TEXT DEFAULT '', "tableRef" INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_REPL_Hist" (id INTEGER PRIMARY KEY, "code" TEXT DEFAULT '', "outputText" TEXT DEFAULT '', "errorText" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_Attachments" (id INTEGER PRIMARY KEY, "fileIdent" TEXT DEFAULT '', "fileName" TEXT DEFAULT '', "fileType" TEXT DEFAULT '', "fileSize" INTEGER DEFAULT 0, "fileExt" TEXT DEFAULT '', "imageHeight" INTEGER DEFAULT 0, "imageWidth" INTEGER DEFAULT 0, "timeDeleted" DATETIME DEFAULT NULL, "timeUploaded" DATETIME DEFAULT NULL);
CREATE TABLE IF NOT EXISTS "_grist_Triggers" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "eventTypes" TEXT DEFAULT NULL, "isReadyColRef" INTEGER DEFAULT 0, "actions" TEXT DEFAULT '', "label" TEXT DEFAULT '', "memo" TEXT DEFAULT '', "enabled" BOOLEAN DEFAULT 0, "watchedColRefList" TEXT DEFAULT NULL, "options" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_ACLRules" (id INTEGER PRIMARY KEY, "resource" INTEGER DEFAULT 0, "permissions" INTEGER DEFAULT 0, "principals" TEXT DEFAULT '', "aclFormula" TEXT DEFAULT '', "aclColumn" INTEGER DEFAULT 0, "aclFormulaParsed" TEXT DEFAULT '', "permissionsText" TEXT DEFAULT '', "rulePos" NUMERIC DEFAULT 1e999, "userAttributes" TEXT DEFAULT '', "memo" TEXT DEFAULT '');
INSERT INTO _grist_ACLRules VALUES(1,1,63,'[1]','',0,'','',1e999,'','');
CREATE TABLE IF NOT EXISTS "_grist_ACLResources" (id INTEGER PRIMARY KEY, "tableId" TEXT DEFAULT '', "colIds" TEXT DEFAULT '');
INSERT INTO _grist_ACLResources VALUES(1,'','');
CREATE TABLE IF NOT EXISTS "_grist_ACLPrincipals" (id INTEGER PRIMARY KEY, "type" TEXT DEFAULT '', "userEmail" TEXT DEFAULT '', "userName" TEXT DEFAULT '', "groupName" TEXT DEFAULT '', "instanceId" TEXT DEFAULT '');
INSERT INTO _grist_ACLPrincipals VALUES(1,'group','','','Owners','');
INSERT INTO _grist_ACLPrincipals VALUES(2,'group','','','Admins','');
INSERT INTO _grist_ACLPrincipals VALUES(3,'group','','','Editors','');
INSERT INTO _grist_ACLPrincipals VALUES(4,'group','','','Viewers','');
CREATE TABLE IF NOT EXISTS "_grist_ACLMemberships" (id INTEGER PRIMARY KEY, "parent" INTEGER DEFAULT 0, "child" INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_Filters" (id INTEGER PRIMARY KEY, "viewSectionRef" INTEGER DEFAULT 0, "colRef" INTEGER DEFAULT 0, "filter" TEXT DEFAULT '', "pinned" BOOLEAN DEFAULT 0);
CREATE TABLE IF NOT EXISTS "_grist_Cells" (id INTEGER PRIMARY KEY, "tableRef" INTEGER DEFAULT 0, "colRef" INTEGER DEFAULT 0, "rowId" INTEGER DEFAULT 0, "root" BOOLEAN DEFAULT 0, "parentId" INTEGER DEFAULT 0, "type" INTEGER DEFAULT 0, "content" TEXT DEFAULT '', "userRef" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "_grist_Shares" (id INTEGER PRIMARY KEY, "linkId" TEXT DEFAULT '', "options" TEXT DEFAULT '', "label" TEXT DEFAULT '', "description" TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS "Table1" (id INTEGER PRIMARY KEY, "manualSort" NUMERIC DEFAULT 1e999, "A" BLOB DEFAULT NULL, "B" BLOB DEFAULT NULL, "C" BLOB DEFAULT NULL);
CREATE INDEX _grist_Attachments_fileIdent ON _grist_Attachments(fileIdent);
COMMIT;
`;
