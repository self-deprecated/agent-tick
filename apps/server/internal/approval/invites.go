package approval

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const (
	MembershipPendingApproval = "pending_approval"
	MembershipActive          = "active"
	MembershipRejected        = "rejected"

	// Invite acceptance statuses are workflow/audit states and intentionally differ
	// from active membership authorization status, which uses MembershipActive.
	InviteAcceptancePendingApproval = "pending_approval"
	InviteAcceptanceApproved        = "approved"
	InviteAcceptanceRejected        = "rejected"
)

type CreateOrganizationInviteRequest struct {
	Label            string     `json:"label"`
	Role             string     `json:"role"`
	TeamIDs          []string   `json:"teamIds,omitempty"`
	ApprovalRequired *bool      `json:"approvalRequired,omitempty"`
	Email            string     `json:"email,omitempty"`
	Domain           string     `json:"domain,omitempty"`
	ExpiresAt        *time.Time `json:"expiresAt,omitempty"`
	MaxUses          *int       `json:"maxUses,omitempty"`
}

type OrganizationInviteRecord struct {
	InviteID         string     `json:"inviteId"`
	OrganizationID   string     `json:"organizationId"`
	Label            string     `json:"label,omitempty"`
	Role             string     `json:"role"`
	TeamIDs          []string   `json:"teamIds,omitempty"`
	ApprovalRequired bool       `json:"approvalRequired"`
	Email            string     `json:"email,omitempty"`
	Domain           string     `json:"domain,omitempty"`
	ExpiresAt        *time.Time `json:"expiresAt,omitempty"`
	MaxUses          *int       `json:"maxUses,omitempty"`
	UsedCount        int        `json:"usedCount"`
	PendingCount     int        `json:"pendingCount"`
	ApprovedCount    int        `json:"approvedCount"`
	RevokedAt        *time.Time `json:"revokedAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	URL              string     `json:"url,omitempty"`
	Token            string     `json:"token,omitempty"`
}

type InvitePreview struct {
	OrganizationName string     `json:"organizationName"`
	Role             string     `json:"role,omitempty"`
	TeamIDs          []string   `json:"teamIds,omitempty"`
	ApprovalRequired bool       `json:"approvalRequired"`
	ExpiresAt        *time.Time `json:"expiresAt,omitempty"`
}

type MembershipRequestRecord struct {
	RequestID        string    `json:"requestId"`
	InviteID         string    `json:"inviteId"`
	OrganizationID   string    `json:"organizationId"`
	UserID           string    `json:"userId"`
	UserName         string    `json:"userName"`
	UserEmail        string    `json:"userEmail"`
	RequestedRole    string    `json:"requestedRole"`
	RequestedTeamIDs []string  `json:"requestedTeamIds"`
	Status           string    `json:"status"`
	AcceptedAt       time.Time `json:"acceptedAt"`
}

type InviteStore interface {
	CreateOrganizationInviteForUser(string, string, CreateOrganizationInviteRequest) (OrganizationInviteRecord, error)
	ListOrganizationInvites(string) ([]OrganizationInviteRecord, error)
	RevokeOrganizationInviteForUser(string, string, string) (OrganizationInviteRecord, error)
	PreviewInvite(string, bool) (InvitePreview, error)
	AcceptInviteForUser(string, string) (MembershipRequestRecord, error)
	ListMembershipRequests(string) ([]MembershipRequestRecord, error)
	ApproveMembershipRequestForUser(string, string, string) (MembershipRequestRecord, error)
	RejectMembershipRequestForUser(string, string, string) (MembershipRequestRecord, error)
}

func newInviteToken() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}
func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
func validInviteRole(role string) bool {
	return role == RoleViewer || role == RoleApprover || role == RoleAdmin
}

func (s *SQLiteStore) CreateOrganizationInviteForUser(actor, org string, in CreateOrganizationInviteRequest) (OrganizationInviteRecord, error) {
	role := strings.ToLower(strings.TrimSpace(in.Role))
	if role == "" {
		role = RoleViewer
	}
	if !validInviteRole(role) {
		return OrganizationInviteRecord{}, ErrInvalidRequest
	}
	actorRole, ok, err := s.OrganizationRoleForUser(actor, org)
	if err != nil {
		return OrganizationInviteRecord{}, err
	}
	if !ok || !roleAllows(actorRole, RoleAdmin) || !roleAllows(actorRole, role) || (role == RoleAdmin && actorRole != RoleOwner) {
		return OrganizationInviteRecord{}, ErrInvalidRequest
	}
	approval := true
	if in.ApprovalRequired != nil {
		approval = *in.ApprovalRequired
	}
	if !approval && actorRole != RoleOwner {
		return OrganizationInviteRecord{}, ErrInvalidRequest
	}
	if in.MaxUses != nil && *in.MaxUses < 1 {
		return OrganizationInviteRecord{}, ErrInvalidRequest
	}
	now := time.Now().UTC()
	if in.ExpiresAt != nil && !in.ExpiresAt.After(now) {
		return OrganizationInviteRecord{}, ErrInvalidRequest
	}
	token, err := newInviteToken()
	if err != nil {
		return OrganizationInviteRecord{}, err
	}
	id := "inv_" + newID()
	tx, err := s.db.Begin()
	if err != nil {
		return OrganizationInviteRecord{}, err
	}
	defer rollback(tx)
	max := sql.NullInt64{}
	if in.MaxUses != nil {
		max.Valid = true
		max.Int64 = int64(*in.MaxUses)
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	domain := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(in.Domain)), "@")
	_, err = tx.Exec(`INSERT INTO organization_invites (id,organization_id,token_hash,created_by_user_id,label,role,approval_required,email,domain,expires_at,max_uses,used_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, org, tokenHash(token), actor, strings.TrimSpace(in.Label), role, boolInt(approval), email, domain, timeText(in.ExpiresAt), max, 0, timeText(&now))
	if err != nil {
		return OrganizationInviteRecord{}, err
	}
	teamIDs := []string{}
	seenTeamIDs := map[string]bool{}
	for _, tid := range in.TeamIDs {
		tid = strings.TrimSpace(tid)
		if tid == "" {
			continue
		}
		if seenTeamIDs[tid] {
			return OrganizationInviteRecord{}, ErrInvalidRequest
		}
		seenTeamIDs[tid] = true
		if err := ensureTeamExistsTx(tx, org, tid); err != nil {
			return OrganizationInviteRecord{}, err
		}
		if _, err := tx.Exec(`INSERT INTO organization_invite_teams (invite_id,team_id) VALUES (?,?)`, id, tid); err != nil {
			return OrganizationInviteRecord{}, err
		}
		teamIDs = append(teamIDs, tid)
	}
	if err := insertAuditForUser(tx, actor, "organization_invite.created", id, map[string]string{"role": role}); err != nil {
		return OrganizationInviteRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return OrganizationInviteRecord{}, err
	}
	return OrganizationInviteRecord{InviteID: id, OrganizationID: org, Label: strings.TrimSpace(in.Label), Role: role, TeamIDs: teamIDs, ApprovalRequired: approval, Email: email, Domain: domain, ExpiresAt: in.ExpiresAt, MaxUses: in.MaxUses, CreatedAt: now, Token: token, URL: "/#/invite/" + token}, nil
}

func (s *SQLiteStore) PreviewInvite(token string, signed bool) (InvitePreview, error) {
	var p InvitePreview
	var id, expires string
	var approvalRequired int
	err := s.db.QueryRow(`SELECT i.id,o.name,i.role,i.approval_required,i.expires_at FROM organization_invites i JOIN organizations o ON o.id=i.organization_id WHERE i.token_hash=? AND i.revoked_at='' AND (i.expires_at='' OR i.expires_at>?)`, tokenHash(token), timeText(ptrTime(time.Now().UTC()))).Scan(&id, &p.OrganizationName, &p.Role, &approvalRequired, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	if err != nil {
		return p, err
	}
	p.ApprovalRequired = approvalRequired != 0
	p.ExpiresAt = parseOptionalTime(expires)
	if signed {
		teamIDs, err := s.inviteTeamIDs(id)
		if err != nil {
			return p, err
		}
		p.TeamIDs = teamIDs
	}
	return p, nil
}

func (s *SQLiteStore) AcceptInviteForUser(user, token string) (MembershipRequestRecord, error) {
	now := time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		return MembershipRequestRecord{}, err
	}
	defer rollback(tx)
	var id, org, role, email, domain string
	var approvalRequired int
	err = tx.QueryRow(`SELECT id,organization_id,role,approval_required,email,domain FROM organization_invites WHERE token_hash=? AND revoked_at='' AND (expires_at='' OR expires_at>?)`, tokenHash(token), timeText(&now)).Scan(&id, &org, &role, &approvalRequired, &email, &domain)
	if errors.Is(err, sql.ErrNoRows) {
		return MembershipRequestRecord{}, ErrNotFound
	}
	if err != nil {
		return MembershipRequestRecord{}, err
	}
	var userEmail, userName string
	if err := tx.QueryRow(`SELECT email,name FROM users WHERE id=?`, user).Scan(&userEmail, &userName); err != nil {
		return MembershipRequestRecord{}, err
	}
	var existingStatus string
	err = tx.QueryRow(`SELECT status FROM organization_memberships WHERE organization_id=? AND user_id=?`, org, user).Scan(&existingStatus)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return MembershipRequestRecord{}, err
	}
	if existingStatus == MembershipActive || existingStatus == MembershipPendingApproval {
		return MembershipRequestRecord{}, ErrInvalidRequest
	}
	var existingAcceptanceCount int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM organization_invite_acceptances WHERE invite_id=? AND user_id=?`, id, user).Scan(&existingAcceptanceCount); err != nil {
		return MembershipRequestRecord{}, err
	}
	if existingAcceptanceCount > 0 {
		return MembershipRequestRecord{}, ErrInvalidRequest
	}
	userEmail = strings.ToLower(strings.TrimSpace(userEmail))
	if email != "" && userEmail != email {
		return MembershipRequestRecord{}, ErrInvalidRequest
	}
	if domain != "" && !strings.HasSuffix(userEmail, "@"+domain) {
		return MembershipRequestRecord{}, ErrInvalidRequest
	}
	tids, err := inviteTeamIDsTx(tx, id)
	if err != nil {
		return MembershipRequestRecord{}, err
	}
	b, _ := json.Marshal(tids)
	rid := "iac_" + newID()
	status := InviteAcceptancePendingApproval
	mstatus := MembershipPendingApproval
	approval := approvalRequired != 0
	if !approval {
		status = InviteAcceptanceApproved
		mstatus = MembershipActive
	}
	res, err := tx.Exec(`INSERT OR IGNORE INTO organization_invite_acceptances (id,invite_id,organization_id,user_id,requested_role,requested_team_ids_json,status,accepted_at) VALUES (?,?,?,?,?,?,?,?)`, rid, id, org, user, role, string(b), status, timeText(&now))
	if err != nil {
		return MembershipRequestRecord{}, err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return MembershipRequestRecord{}, ErrInvalidRequest
	}
	approvedAt := ""
	if !approval {
		if err := enforceOrganizationPlanLimitTx(tx, org, "seats", "seat", "SELECT COUNT(*) FROM organization_memberships WHERE organization_id = ? AND status = 'active'", org); err != nil {
			return MembershipRequestRecord{}, err
		}
		approvedAt = timeText(&now)
	}
	res, err = tx.Exec(`INSERT INTO organization_memberships (organization_id,user_id,role,status,invite_id,approved_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role,status=excluded.status,invite_id=excluded.invite_id,approved_at=excluded.approved_at,updated_at=excluded.updated_at`, org, user, role, mstatus, id, approvedAt, timeText(&now), timeText(&now))
	if err != nil {
		return MembershipRequestRecord{}, err
	}
	n, _ = res.RowsAffected()
	if n != 1 {
		return MembershipRequestRecord{}, ErrInvalidRequest
	}
	res, err = tx.Exec(`UPDATE organization_invites SET used_count=used_count+1 WHERE id=? AND revoked_at='' AND (expires_at='' OR expires_at>?) AND (max_uses IS NULL OR used_count<max_uses)`, id, timeText(&now))
	if err != nil {
		return MembershipRequestRecord{}, err
	}
	n, _ = res.RowsAffected()
	if n != 1 {
		return MembershipRequestRecord{}, ErrInvalidRequest
	}
	if !approval {
		for _, tid := range tids {
			if err := ensureTeamExistsTx(tx, org, tid); err != nil {
				if errors.Is(err, ErrNotFound) {
					return MembershipRequestRecord{}, ErrInvalidRequest
				}
				return MembershipRequestRecord{}, err
			}
			if _, err := tx.Exec(`INSERT INTO team_members (team_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(team_id,user_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at`, tid, user, role, timeText(&now), timeText(&now)); err != nil {
				return MembershipRequestRecord{}, err
			}
			if err := insertAuditForUser(tx, user, "team_member.upserted", tid, map[string]string{"userId": user, "role": role, "inviteId": id}); err != nil {
				return MembershipRequestRecord{}, err
			}
		}
	}
	if err := insertAuditForUser(tx, user, "organization_invite.accepted", id, map[string]string{"organizationId": org}); err != nil {
		return MembershipRequestRecord{}, err
	}
	if approval {
		if err := insertAuditForUser(tx, user, "organization_membership.pending", org, map[string]string{"inviteId": id, "role": role}); err != nil {
			return MembershipRequestRecord{}, err
		}
	}
	if !approval {
		if err := insertAuditForUser(tx, user, "organization_membership.approved", org, map[string]string{"inviteId": id, "role": role}); err != nil {
			return MembershipRequestRecord{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return MembershipRequestRecord{}, err
	}
	return MembershipRequestRecord{RequestID: rid, InviteID: id, OrganizationID: org, UserID: user, UserName: userName, UserEmail: userEmail, RequestedRole: role, RequestedTeamIDs: tids, Status: status, AcceptedAt: now}, nil
}

func inviteTeamIDsTx(tx *sql.Tx, id string) ([]string, error) {
	rows, err := tx.Query(`SELECT team_id FROM organization_invite_teams WHERE invite_id=?`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var tid string
		if err := rows.Scan(&tid); err != nil {
			return nil, err
		}
		out = append(out, tid)
	}
	return out, rows.Err()
}
func (s *SQLiteStore) inviteTeamIDs(id string) ([]string, error) {
	rows, err := s.db.Query(`SELECT team_id FROM organization_invite_teams WHERE invite_id=?`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var tid string
		if err := rows.Scan(&tid); err != nil {
			return nil, err
		}
		out = append(out, tid)
	}
	return out, rows.Err()
}

func (s *SQLiteStore) ListOrganizationInvites(org string) ([]OrganizationInviteRecord, error) {
	rows, err := s.db.Query(`SELECT id,organization_id,label,role,approval_required,email,domain,expires_at,max_uses,used_count,revoked_at,created_at FROM organization_invites WHERE organization_id=? ORDER BY created_at DESC`, org)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OrganizationInviteRecord{}
	for rows.Next() {
		var r OrganizationInviteRecord
		var exp, rev, created string
		var max sql.NullInt64
		var approvalRequired int
		if err := rows.Scan(&r.InviteID, &r.OrganizationID, &r.Label, &r.Role, &approvalRequired, &r.Email, &r.Domain, &exp, &max, &r.UsedCount, &rev, &created); err != nil {
			return nil, err
		}
		r.ApprovalRequired = approvalRequired != 0
		r.ExpiresAt = parseOptionalTime(exp)
		r.RevokedAt = parseOptionalTime(rev)
		if max.Valid {
			v := int(max.Int64)
			r.MaxUses = &v
		}
		r.CreatedAt, _ = parseTime(created)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range out {
		out[i].TeamIDs, err = s.inviteTeamIDs(out[i].InviteID)
		if err != nil {
			return nil, err
		}
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM organization_invite_acceptances WHERE invite_id=? AND status='pending_approval'`, out[i].InviteID).Scan(&out[i].PendingCount); err != nil {
			return nil, err
		}
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM organization_invite_acceptances WHERE invite_id=? AND status='approved'`, out[i].InviteID).Scan(&out[i].ApprovedCount); err != nil {
			return nil, err
		}
	}
	return out, nil
}
func (s *SQLiteStore) RevokeOrganizationInviteForUser(actor, org, id string) (OrganizationInviteRecord, error) {
	role, ok, err := s.OrganizationRoleForUser(actor, org)
	if err != nil {
		return OrganizationInviteRecord{}, err
	}
	if !ok || !roleAllows(role, RoleAdmin) {
		return OrganizationInviteRecord{}, ErrInvalidRequest
	}
	now := time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		return OrganizationInviteRecord{}, err
	}
	defer rollback(tx)
	res, err := tx.Exec(`UPDATE organization_invites SET revoked_at=? WHERE id=? AND organization_id=? AND revoked_at=''`, timeText(&now), id, org)
	if err != nil {
		return OrganizationInviteRecord{}, err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return OrganizationInviteRecord{}, ErrNotFound
	}
	if err := insertAuditForUser(tx, actor, "organization_invite.revoked", id, map[string]string{"organizationId": org}); err != nil {
		return OrganizationInviteRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return OrganizationInviteRecord{}, err
	}
	return OrganizationInviteRecord{InviteID: id, OrganizationID: org, RevokedAt: &now}, nil
}
func (s *SQLiteStore) ListMembershipRequests(org string) ([]MembershipRequestRecord, error) {
	rows, err := s.db.Query(`SELECT a.id,a.invite_id,a.organization_id,a.user_id,u.name,u.email,a.requested_role,a.requested_team_ids_json,a.status,a.accepted_at FROM organization_invite_acceptances a JOIN users u ON u.id=a.user_id WHERE a.organization_id=? AND a.status='pending_approval' ORDER BY a.accepted_at`, org)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MembershipRequestRecord{}
	for rows.Next() {
		var r MembershipRequestRecord
		var js, at string
		if err := rows.Scan(&r.RequestID, &r.InviteID, &r.OrganizationID, &r.UserID, &r.UserName, &r.UserEmail, &r.RequestedRole, &js, &r.Status, &at); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(js), &r.RequestedTeamIDs)
		r.AcceptedAt, _ = parseTime(at)
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *SQLiteStore) ApproveMembershipRequestForUser(actor, org, rid string) (MembershipRequestRecord, error) {
	return s.decideMembershipRequest(actor, org, rid, true)
}
func (s *SQLiteStore) RejectMembershipRequestForUser(actor, org, rid string) (MembershipRequestRecord, error) {
	return s.decideMembershipRequest(actor, org, rid, false)
}
func (s *SQLiteStore) decideMembershipRequest(actor, org, rid string, approve bool) (MembershipRequestRecord, error) {
	role, ok, err := s.OrganizationRoleForUser(actor, org)
	if err != nil {
		return MembershipRequestRecord{}, err
	}
	if !ok || !roleAllows(role, RoleAdmin) {
		return MembershipRequestRecord{}, ErrInvalidRequest
	}
	now := time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		return MembershipRequestRecord{}, err
	}
	defer rollback(tx)
	status := InviteAcceptanceRejected
	mstatus := MembershipRejected
	ev := "organization_membership.rejected"
	if approve {
		status = InviteAcceptanceApproved
		mstatus = MembershipActive
		ev = "organization_membership.approved"
	}
	var user, reqRole, js, inviteID, userName, userEmail, acceptedAt string
	err = tx.QueryRow(`SELECT a.user_id,a.requested_role,a.requested_team_ids_json,a.invite_id,u.name,u.email,a.accepted_at FROM organization_invite_acceptances a JOIN users u ON u.id=a.user_id WHERE a.id=? AND a.organization_id=? AND a.status='pending_approval'`, rid, org).Scan(&user, &reqRole, &js, &inviteID, &userName, &userEmail, &acceptedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return MembershipRequestRecord{}, ErrNotFound
	}
	if err != nil {
		return MembershipRequestRecord{}, err
	}
	tids := []string{}
	_ = json.Unmarshal([]byte(js), &tids)
	if approve {
		if err := enforceOrganizationPlanLimitTx(tx, org, "seats", "seat", "SELECT COUNT(*) FROM organization_memberships WHERE organization_id = ? AND status = 'active'", org); err != nil {
			return MembershipRequestRecord{}, err
		}
	}
	if _, err = tx.Exec(`UPDATE organization_invite_acceptances SET status=?,decided_by_user_id=?,decided_at=? WHERE id=?`, status, actor, timeText(&now), rid); err != nil {
		return MembershipRequestRecord{}, err
	}
	if approve {
		res, err := tx.Exec(`UPDATE organization_memberships SET status=?,role=?,approved_by_user_id=?,approved_at=?,updated_at=? WHERE organization_id=? AND user_id=?`, mstatus, reqRole, actor, timeText(&now), timeText(&now), org, user)
		if err != nil {
			return MembershipRequestRecord{}, err
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return MembershipRequestRecord{}, ErrNotFound
		}
	} else {
		res, err := tx.Exec(`UPDATE organization_memberships SET status=?,rejected_by_user_id=?,rejected_at=?,updated_at=? WHERE organization_id=? AND user_id=?`, mstatus, actor, timeText(&now), timeText(&now), org, user)
		if err != nil {
			return MembershipRequestRecord{}, err
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return MembershipRequestRecord{}, ErrNotFound
		}
	}
	if approve {
		for _, tid := range tids {
			if err := ensureTeamExistsTx(tx, org, tid); err != nil {
				if errors.Is(err, ErrNotFound) {
					return MembershipRequestRecord{}, ErrInvalidRequest
				}
				return MembershipRequestRecord{}, err
			}
			if _, err := tx.Exec(`INSERT INTO team_members (team_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(team_id,user_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at`, tid, user, reqRole, timeText(&now), timeText(&now)); err != nil {
				return MembershipRequestRecord{}, err
			}
			if err := insertAuditForUser(tx, actor, "team_member.upserted", tid, map[string]string{"userId": user, "role": reqRole, "requestId": rid}); err != nil {
				return MembershipRequestRecord{}, err
			}
		}
	}
	if err := insertAuditForUser(tx, actor, ev, rid, map[string]string{"userId": user}); err != nil {
		return MembershipRequestRecord{}, err
	}
	if err = tx.Commit(); err != nil {
		return MembershipRequestRecord{}, err
	}
	parsedAcceptedAt, _ := parseTime(acceptedAt)
	return MembershipRequestRecord{RequestID: rid, InviteID: inviteID, OrganizationID: org, UserID: user, UserName: userName, UserEmail: userEmail, RequestedRole: reqRole, RequestedTeamIDs: tids, Status: status, AcceptedAt: parsedAcceptedAt}, nil
}
