package approval

import (
	"errors"
	"testing"
	"time"
)

func TestOrganizationInviteValidationAndRestrictions(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	owner, err := store.LoginOrCreateUser("owner@example.com", "password", "Owner", 0)
	if err != nil {
		t.Fatalf("owner login error = %v", err)
	}
	org, err := store.CreateOrganizationForUser(owner.UserID, "Acme")
	if err != nil {
		t.Fatalf("create org error = %v", err)
	}
	if _, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: "superadmin"}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("invalid role error = %v, want ErrInvalidRequest", err)
	}
	admin, err := store.LoginOrCreateUser("admin@example.com", "password", "Admin", 0)
	if err != nil {
		t.Fatalf("admin login error = %v", err)
	}
	if _, err := store.db.Exec(`INSERT INTO organization_memberships (organization_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)`, org.OrganizationID, admin.UserID, RoleAdmin, timeText(ptrTime(time.Now().UTC())), timeText(ptrTime(time.Now().UTC()))); err != nil {
		t.Fatalf("insert admin membership error = %v", err)
	}
	team, err := store.CreateTeam(org.OrganizationID, CreateTeamRequest{Name: "Platform"})
	if err != nil {
		t.Fatalf("create team error = %v", err)
	}
	if _, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer, TeamIDs: []string{team.TeamID, team.TeamID}}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("duplicate team invite error = %v, want ErrInvalidRequest", err)
	}
	normalizedInvite, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer, Email: " PERSON@Example.COM ", Domain: "@Example.COM"})
	if err != nil {
		t.Fatalf("create normalized invite error = %v", err)
	}
	if normalizedInvite.Email != "person@example.com" || normalizedInvite.Domain != "example.com" {
		t.Fatalf("normalized email/domain = %q/%q", normalizedInvite.Email, normalizedInvite.Domain)
	}
	if _, err := store.CreateOrganizationInviteForUser(admin.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleAdmin}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("admin role invite by admin error = %v, want ErrInvalidRequest", err)
	}
	approvalRequired := false
	if _, err := store.CreateOrganizationInviteForUser(admin.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer, ApprovalRequired: &approvalRequired}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("auto-approved invite by admin error = %v, want ErrInvalidRequest", err)
	}
	invite, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer, Email: "allowed@example.com", MaxUses: intPtr(1)})
	if err != nil {
		t.Fatalf("create invite error = %v", err)
	}
	other, err := store.LoginOrCreateUser("other@example.com", "password", "Other", 0)
	if err != nil {
		t.Fatalf("other login error = %v", err)
	}
	if _, err := store.AcceptInviteForUser(other.UserID, invite.Token); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("restricted accept error = %v, want ErrInvalidRequest", err)
	}
	var usedCount int
	if err := store.db.QueryRow(`SELECT used_count FROM organization_invites WHERE id=?`, invite.InviteID).Scan(&usedCount); err != nil {
		t.Fatalf("used_count query error = %v", err)
	}
	if usedCount != 0 {
		t.Fatalf("used_count after invalid accept = %d, want 0", usedCount)
	}
	allowed, err := store.LoginOrCreateUser("allowed@example.com", "password", "Allowed", 0)
	if err != nil {
		t.Fatalf("allowed login error = %v", err)
	}
	if _, err := store.AcceptInviteForUser(allowed.UserID, invite.Token); err != nil {
		t.Fatalf("allowed accept error = %v", err)
	}
	if _, err := store.AcceptInviteForUser(allowed.UserID, invite.Token); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("duplicate pending accept error = %v, want ErrInvalidRequest", err)
	}
	oneUse, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer, MaxUses: intPtr(1)})
	if err != nil {
		t.Fatalf("create one-use invite error = %v", err)
	}
	extra, _ := store.LoginOrCreateUser("extra@example.com", "password", "Extra", 0)
	if _, err := store.AcceptInviteForUser(extra.UserID, oneUse.Token); err != nil {
		t.Fatalf("first one-use accept error = %v", err)
	}
	extra2, _ := store.LoginOrCreateUser("extra2@example.com", "password", "Extra2", 0)
	if _, err := store.AcceptInviteForUser(extra2.UserID, oneUse.Token); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("max uses accept error = %v, want ErrInvalidRequest", err)
	}
}

func TestOrganizationInviteRestrictionsExpiryAndAutoApproval(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	owner, _ := store.LoginOrCreateUser("owner@example.com", "password", "Owner", 0)
	org, err := store.CreateOrganizationForUser(owner.UserID, "Acme")
	if err != nil {
		t.Fatalf("create org error = %v", err)
	}
	team, err := store.CreateTeam(org.OrganizationID, CreateTeamRequest{Name: "Platform"})
	if err != nil {
		t.Fatalf("create team error = %v", err)
	}
	past := time.Now().UTC().Add(-time.Minute)
	if _, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer, ExpiresAt: &past}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("create expired invite error = %v, want ErrInvalidRequest", err)
	}
	expiresSoon := time.Now().UTC().Add(time.Hour)
	expiringInvite, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer, ExpiresAt: &expiresSoon})
	if err != nil {
		t.Fatalf("create expiring invite error = %v", err)
	}
	if _, err := store.db.Exec(`UPDATE organization_invites SET expires_at=? WHERE id=?`, timeText(ptrTime(time.Now().UTC().Add(-time.Minute))), expiringInvite.InviteID); err != nil {
		t.Fatalf("expire invite error = %v", err)
	}
	expiredUser, _ := store.LoginOrCreateUser("expired@example.com", "password", "Expired", 0)
	if _, err := store.AcceptInviteForUser(expiredUser.UserID, expiringInvite.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("accept expired invite error = %v, want ErrNotFound", err)
	}
	revokedInvite, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer})
	if err != nil {
		t.Fatalf("create revoked invite error = %v", err)
	}
	if _, err := store.RevokeOrganizationInviteForUser(owner.UserID, org.OrganizationID, revokedInvite.InviteID); err != nil {
		t.Fatalf("revoke invite error = %v", err)
	}
	revokedUser, _ := store.LoginOrCreateUser("revoked@example.com", "password", "Revoked", 0)
	if _, err := store.AcceptInviteForUser(revokedUser.UserID, revokedInvite.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("accept revoked invite error = %v, want ErrNotFound", err)
	}

	domainInvite, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer, Domain: "Example.COM"})
	if err != nil {
		t.Fatalf("create domain invite error = %v", err)
	}
	outsider, _ := store.LoginOrCreateUser("person@other.test", "password", "Outsider", 0)
	if _, err := store.AcceptInviteForUser(outsider.UserID, domainInvite.Token); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("domain mismatch error = %v, want ErrInvalidRequest", err)
	}

	approvalRequired := false
	autoInvite, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleApprover, TeamIDs: []string{team.TeamID}, ApprovalRequired: &approvalRequired})
	if err != nil {
		t.Fatalf("create auto invite error = %v", err)
	}
	autoUser, _ := store.LoginOrCreateUser("auto@example.com", "password", "Auto", 0)
	accepted, err := store.AcceptInviteForUser(autoUser.UserID, autoInvite.Token)
	if err != nil {
		t.Fatalf("auto accept error = %v", err)
	}
	if accepted.Status != "approved" {
		t.Fatalf("auto status = %q, want approved", accepted.Status)
	}
	members, err := store.ListTeamMembers(org.OrganizationID, team.TeamID)
	if err != nil {
		t.Fatalf("list members error = %v", err)
	}
	found := false
	for _, member := range members {
		if member.UserID == autoUser.UserID && member.Role == RoleApprover {
			found = true
		}
	}
	if !found {
		t.Fatalf("auto-approved user was not added to team: %#v", members)
	}
}

func TestOrganizationInviteApprovalAppliesTeamsAndNotFound(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	owner, _ := store.LoginOrCreateUser("owner@example.com", "password", "Owner", 0)
	org, err := store.CreateOrganizationForUser(owner.UserID, "Acme")
	if err != nil {
		t.Fatalf("create org error = %v", err)
	}
	team, err := store.CreateTeam(org.OrganizationID, CreateTeamRequest{Name: "Platform"})
	if err != nil {
		t.Fatalf("create team error = %v", err)
	}
	invite, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleApprover, TeamIDs: []string{team.TeamID}})
	if err != nil {
		t.Fatalf("create invite error = %v", err)
	}
	user, _ := store.LoginOrCreateUser("new@example.com", "password", "New", 0)
	request, err := store.AcceptInviteForUser(user.UserID, invite.Token)
	if err != nil {
		t.Fatalf("accept error = %v", err)
	}
	if _, err := store.ApproveMembershipRequestForUser(owner.UserID, org.OrganizationID, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing approval error = %v, want ErrNotFound", err)
	}
	if _, err := store.ApproveMembershipRequestForUser(owner.UserID, org.OrganizationID, request.RequestID); err != nil {
		t.Fatalf("approve error = %v", err)
	}
	members, err := store.ListTeamMembers(org.OrganizationID, team.TeamID)
	if err != nil {
		t.Fatalf("list members error = %v", err)
	}
	found := false
	for _, member := range members {
		if member.UserID == user.UserID && member.Role == RoleApprover {
			found = true
		}
	}
	if !found {
		t.Fatalf("approved user was not added to team: %#v", members)
	}
	if _, err := store.RevokeOrganizationInviteForUser(owner.UserID, org.OrganizationID, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing revoke error = %v, want ErrNotFound", err)
	}
}

func TestOrganizationInviteApprovalEnforcesSeatLimit(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	owner, _ := store.LoginOrCreateUser("owner@example.com", "password", "Owner", 0)
	org, err := store.CreateOrganizationForUser(owner.UserID, "Acme")
	if err != nil {
		t.Fatalf("create org error = %v", err)
	}
	if _, err := store.db.Exec(`UPDATE organizations SET seat_limit=1 WHERE id=?`, org.OrganizationID); err != nil {
		t.Fatalf("set seat limit error = %v", err)
	}
	invite, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer})
	if err != nil {
		t.Fatalf("create invite error = %v", err)
	}
	user, _ := store.LoginOrCreateUser("limited@example.com", "password", "Limited", 0)
	request, err := store.AcceptInviteForUser(user.UserID, invite.Token)
	if err != nil {
		t.Fatalf("accept error = %v", err)
	}
	if _, err := store.ApproveMembershipRequestForUser(owner.UserID, org.OrganizationID, request.RequestID); !errors.Is(err, ErrPlanLimitExceeded) {
		t.Fatalf("approve over seat limit error = %v, want ErrPlanLimitExceeded", err)
	}

	approvalRequired := false
	autoInvite, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer, ApprovalRequired: &approvalRequired})
	if err != nil {
		t.Fatalf("create auto invite error = %v", err)
	}
	autoUser, _ := store.LoginOrCreateUser("autolimited@example.com", "password", "AutoLimited", 0)
	if _, err := store.AcceptInviteForUser(autoUser.UserID, autoInvite.Token); !errors.Is(err, ErrPlanLimitExceeded) {
		t.Fatalf("auto accept over seat limit error = %v, want ErrPlanLimitExceeded", err)
	}
}

func TestOrganizationInviteRejectionMarksMembershipRejected(t *testing.T) {
	store := newTestSQLiteStore(t)
	defer store.Close()

	owner, _ := store.LoginOrCreateUser("owner@example.com", "password", "Owner", 0)
	org, err := store.CreateOrganizationForUser(owner.UserID, "Acme")
	if err != nil {
		t.Fatalf("create org error = %v", err)
	}
	invite, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer})
	if err != nil {
		t.Fatalf("create invite error = %v", err)
	}
	user, _ := store.LoginOrCreateUser("reject@example.com", "password", "Reject", 0)
	request, err := store.AcceptInviteForUser(user.UserID, invite.Token)
	if err != nil {
		t.Fatalf("accept error = %v", err)
	}
	rejected, err := store.RejectMembershipRequestForUser(owner.UserID, org.OrganizationID, request.RequestID)
	if err != nil {
		t.Fatalf("reject error = %v", err)
	}
	if rejected.Status != InviteAcceptanceRejected {
		t.Fatalf("rejected status = %q, want %q", rejected.Status, InviteAcceptanceRejected)
	}
	var status string
	if err := store.db.QueryRow(`SELECT status FROM organization_memberships WHERE organization_id=? AND user_id=?`, org.OrganizationID, user.UserID).Scan(&status); err != nil {
		t.Fatalf("membership status query error = %v", err)
	}
	if status != MembershipRejected {
		t.Fatalf("membership status = %q, want %q", status, MembershipRejected)
	}
	if _, err := store.AcceptInviteForUser(user.UserID, invite.Token); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("re-accept rejected invite error = %v, want ErrInvalidRequest", err)
	}
	otherInvite, err := store.CreateOrganizationInviteForUser(owner.UserID, org.OrganizationID, CreateOrganizationInviteRequest{Role: RoleViewer})
	if err != nil {
		t.Fatalf("create second invite error = %v", err)
	}
	if _, err := store.AcceptInviteForUser(user.UserID, otherInvite.Token); err != nil {
		t.Fatalf("accept different invite after rejection error = %v, want nil", err)
	}
}

func intPtr(v int) *int { return &v }
