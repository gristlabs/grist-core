import { ReferenceConnectionLink } from "app/gen-server/entity/ReferenceConnectionLink";
import { ReferencePublication } from "app/gen-server/entity/ReferencePublication";
import { ReferenceSubscription } from "app/gen-server/entity/ReferenceSubscription";
import { referenceAuditState } from "app/server/lib/ReferenceAudit";

import { assert } from "chai";

describe("Reference audit allowlist", () => {
  it("audits link restrictions without recording its secret or hash", () => {
    const link = Object.assign(new ReferenceConnectionLink(), {
      id: "link", publicationId: "publication", disabled: false, allowedOrgIds: [3],
      maxAdmissions: 4, admissions: 1, expiresAt: "2027-01-01", secretHash: "never-log", url: "never-log",
    });
    const before = referenceAuditState(link);
    link.allowedOrgIds.push(5);
    assert.deepEqual(before, { publication_id: "publication", connection_link_id: "link", disabled: false,
      allowed_org_ids: [3], max_admissions: 4, admissions: 1, expires_at: "2027-01-01" });
  });

  it("retains contract identifiers and versions without publication contents", () => {
    const pub = Object.assign(new ReferencePublication(), {
      id: "publication", sourceDocId: "source", contractVersion: 2, paused: false,
      spec: { name: "confidential", tables: [{ filters: [{ values: ["secret"] }] }] },
      secretHash: "never-log", url: "never-log",
    });
    assert.deepEqual(referenceAuditState(pub), {
      publication_id: "publication", source_document_id: "source", contract_version: 2, paused: false,
    });
  });

  it("captures immutable before/after states without credentials or local aliases", () => {
    const sub = Object.assign(new ReferenceSubscription(), {
      id: "subscription", publicationId: "publication", destinationDocId: "destination", connectionLinkId: "link",
      acceptedContractVersion: 1, appliedContractVersion: 1, authorizationVersion: 4,
      status: "UP_TO_DATE", revoked: false, sourcePaused: false, destinationPaused: false,
      aliases: { 1: "confidential" }, url: "never-log", secretHash: "never-log",
    });
    const before = referenceAuditState(sub);
    sub.acceptedContractVersion = 2;
    sub.authorizationVersion++;
    const after = referenceAuditState(sub);
    assert.equal(before.accepted_contract_version, 1);
    assert.equal(after.accepted_contract_version, 2);
    assert.equal(after.authorization_version, 5);
    assert.equal(after.connection_link_id, "link");
    assert.notMatch(JSON.stringify(after), /confidential|never-log|aliases|url|secret/);
  });
});
