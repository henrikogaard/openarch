import {
  createDomain,
  DOMAIN_COLORS,
  elementsInDomain,
  primaryText,
  WORKSPACE_STATUSES,
  type Domain,
  type Model,
  type ModelPurpose,
  type WorkspaceStatus,
} from '@openarch/core';
import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import type { ConnectorConfig } from '@openarch/connectors';

export interface MemberDraft {
  subject: string;
  role: 'owner' | 'editor' | 'viewer';
  displayName?: string;
}

export interface GroupRoleDraft {
  group: string;
  role: 'owner' | 'editor' | 'viewer';
}

interface WorkspaceSettingsProps {
  model: Model;
  connectors?: ConnectorConfig;
  onConnectorsChange?: (config: ConnectorConfig) => void;
  serverOrgId?: string | null;
  onSetOrg?: (orgId: string | null) => void;
  /** Present in server mode: loads and saves workspace members. */
  membersManager?: {
    load: () => Promise<{ members: MemberDraft[]; groupRoles: GroupRoleDraft[] }>;
    save: (members: MemberDraft[], groupRoles: GroupRoleDraft[]) => Promise<void>;
  } | null;
  onUpdate: (patch: Partial<Model>) => void;
  onBack: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

const PURPOSE_LABEL: Record<ModelPurpose, string> = {
  'as-is': 'AS-IS',
  'to-be': 'TO-BE',
  migration: 'Migration',
};

export default function WorkspaceSettings({
  model,
  connectors = {},
  onConnectorsChange,
  serverOrgId,
  onSetOrg,
  membersManager = null,
  onUpdate,
  onBack,
  onDuplicate,
  onArchive,
  onDelete,
}: WorkspaceSettingsProps) {
  const t = useTranslation();
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [groupRoles, setGroupRoles] = useState<GroupRoleDraft[]>([]);
  const [memberSubject, setMemberSubject] = useState('');
  const [memberRole, setMemberRole] = useState<'owner' | 'editor' | 'viewer'>('editor');
  const [groupRoleGroup, setGroupRoleGroup] = useState('');
  const [groupRoleRole, setGroupRoleRole] = useState<'owner' | 'editor' | 'viewer'>('viewer');
  const [membersStatus, setMembersStatus] = useState('');

  useEffect(() => {
    if (!membersManager) return;
    let cancelled = false;
    membersManager
      .load()
      .then((next) => {
        if (cancelled) return;
        setMembers(
          (next.members ?? []).map((member) => ({
            subject: member.subject,
            role: member.role,
            displayName: member.displayName,
          })),
        );
        setGroupRoles(
          (next.groupRoles ?? []).map((mapping) => ({ group: mapping.group, role: mapping.role })),
        );
      })
      .catch((error) => {
        if (!cancelled) setMembersStatus(`Could not load members: ${error.message}`);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per manager instance
  }, [membersManager]);

  const saveMembers = async () => {
    if (!membersManager) return;
    setMembersStatus('');
    try {
      await membersManager.save(members, groupRoles);
      setMembersStatus('Members updated');
    } catch (error) {
      setMembersStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const [name, setName] = useState(primaryText(model.name));
  const [description, setDescription] = useState(primaryText(model.documentation));
  const [owner, setOwner] = useState(model.owner ?? '');
  const [tagText, setTagText] = useState((model.tags ?? []).join(', '));

  const domains = model.domains ?? [];
  const unassigned = model.elements.filter((element) => !element.domain);

  const updateDomain = (id: string, patch: Partial<Domain>) => {
    onUpdate({ domains: domains.map((domain) => (domain.id === id ? { ...domain, ...patch } : domain)) });
  };

  const addDomain = () => {
    const next = createDomain(`Domain ${domains.length + 1}`, {
      color: DOMAIN_COLORS[domains.length % DOMAIN_COLORS.length],
    });
    onUpdate({ domains: [...domains, next] });
  };

  const removeDomain = (id: string) => {
    if (!window.confirm('Remove this domain? Elements stay in the model but become unassigned.')) return;
    onUpdate({
      domains: domains.filter((domain) => domain.id !== id),
      elements: model.elements.map((element) =>
        element.domain === id ? { ...element, domain: undefined } : element,
      ),
    });
  };

  const assignUnassigned = (domainId: string) => {
    if (!domainId) return;
    onUpdate({
      elements: model.elements.map((element) =>
        element.domain ? element : { ...element, domain: domainId },
      ),
    });
  };

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <button className="link-button" onClick={onBack}>
            ← All workspaces
          </button>
          <h2>{t('workspaceSettings')}</h2>
          <p>Metadata, domains, and lifecycle for this workspace.</p>
        </div>
        <div className="stat-inline">
          <span className="chip">{model.elements.length} elements</span>
          <span className="chip">{domains.length} domains</span>
          <span className="chip">{model.artefacts?.length ?? 0} artefacts</span>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="panel-card">
          <h3>{t('identity')}</h3>
          <label className="field">
            Name
            <input
              className="form-input full"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                if (name.trim() && name !== primaryText(model.name)) {
                  onUpdate({ name: [{ lang: 'en', value: name.trim() }] });
                }
              }}
            />
          </label>
          <label className="field">
            Description
            <textarea
              className="form-input full"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => onUpdate({ documentation: description ? [{ lang: 'en', value: description }] : [] })}
            />
          </label>
          <div className="field-row">
            <label className="field">
              Purpose
              <select
                value={model.purpose ?? 'as-is'}
                onChange={(event) => onUpdate({ purpose: event.target.value as ModelPurpose })}
              >
                {(Object.keys(PURPOSE_LABEL) as ModelPurpose[]).map((value) => (
                  <option key={value} value={value}>
                    {PURPOSE_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Status
              <select
                value={model.status ?? 'draft'}
                onChange={(event) => onUpdate({ status: event.target.value as WorkspaceStatus })}
              >
                {WORKSPACE_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value[0].toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              Owner
              <input
                className="form-input full"
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                onBlur={() => onUpdate({ owner: owner.trim() })}
                placeholder={t('ownerLabel')}
              />
            </label>
            <label className="field">
              Tags
              <input
                className="form-input full"
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                onBlur={() =>
                  onUpdate({
                    tags: tagText
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="cloud, payments"
              />
            </label>
          </div>
        </section>

        <section className="panel-card">
          <div className="section-heading">
            <h3>{t('domainsHeading')}</h3>
            <button className="small-button" onClick={addDomain}>
              + Add domain
            </button>
          </div>
          <p className="muted">
            Domains partition the model by area. Assign elements in the inspector, or bulk-assign the
            unassigned ones below.
          </p>
          <ul className="domain-list">
            {domains.map((domain) => (
              <li key={domain.id}>
                <input
                  type="color"
                  aria-label={`${domain.name} colour`}
                  value={domain.color ?? '#2563eb'}
                  onChange={(event) => updateDomain(domain.id, { color: event.target.value })}
                />
                <input
                  className="form-input"
                  value={domain.name}
                  onChange={(event) => updateDomain(domain.id, { name: event.target.value })}
                />
                <input
                  className="form-input"
                  value={domain.owner ?? ''}
                  placeholder="Owner"
                  onChange={(event) => updateDomain(domain.id, { owner: event.target.value })}
                />
                <span className="chip">{elementsInDomain(model, domain.id).length}</span>
                <button className="icon-button" onClick={() => removeDomain(domain.id)} title="Remove domain">
                  ×
                </button>
              </li>
            ))}
            {domains.length === 0 && <li className="empty">{t('noDomains')}</li>}
          </ul>
          {unassigned.length > 0 && (
            <label className="field">
              Assign {unassigned.length} unassigned element(s) to
              <select defaultValue="" onChange={(event) => assignUnassigned(event.target.value)}>
                <option value="" disabled>
                  Choose a domain…
                </option>
                {domains.map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        {onSetOrg && (
          <section className="panel-card wide">
            <h3>Organisation (server mode)</h3>
            <div className="field-row">
              <label className="field">
                Org / tenant id
                <input
                  className="form-input full"
                  placeholder="org-acme"
                  defaultValue={serverOrgId ?? ''}
                  onBlur={(event) => onSetOrg(event.target.value.trim() || null)}
                />
              </label>
            </div>
            <p className="muted">Scopes the workspace list with ?orgId= on the server.</p>
          </section>
        )}

        <section className="panel-card wide">
          <h3>{t('connectors')}</h3>
          <p className="muted">
            Link elements to Jira issues, Confluence pages, and ServiceNow CIs; publish views to
            Confluence. The token is kept in this browser session only.
          </p>
          <div className="field-row">
            <label className="field">
              Jira base URL
              <input
                className="form-input full"
                placeholder="https://company.atlassian.net"
                value={connectors.jiraBaseUrl ?? ''}
                onChange={(event) => onConnectorsChange?.({ ...connectors, jiraBaseUrl: event.target.value || undefined })}
              />
            </label>
            <label className="field">
              Confluence base URL
              <input
                className="form-input full"
                placeholder="https://company.atlassian.net/wiki"
                value={connectors.confluenceBaseUrl ?? ''}
                onChange={(event) => onConnectorsChange?.({ ...connectors, confluenceBaseUrl: event.target.value || undefined })}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              ServiceNow instance URL
              <input
                className="form-input full"
                placeholder="https://company.service-now.com"
                value={connectors.serviceNowUrl ?? ''}
                onChange={(event) => onConnectorsChange?.({ ...connectors, serviceNowUrl: event.target.value || undefined })}
              />
            </label>
            <label className="field">
              API token (session only)
              <input
                className="form-input full"
                type="password"
                autoComplete="off"
                value={connectors.token ?? ''}
                onChange={(event) => onConnectorsChange?.({ ...connectors, token: event.target.value || undefined })}
              />
            </label>
          </div>
        </section>

        {membersManager && (
          <section className="panel-card wide">
            <h3>{t('members')}</h3>
            <table className="relation-list">
              <tbody>
                {members.map((member, index) => (
                  <tr key={member.subject + index}>
                    <td>
                      <input
                        className="form-input"
                        value={member.subject}
                        aria-label={t('subject')}
                        onChange={(event) => {
                          const next = [...members];
                          next[index] = { ...member, subject: event.target.value };
                          setMembers(next);
                        }}
                      />
                    </td>
                    <td>
                      <select
                        value={member.role}
                        onChange={(event) => {
                          const next = [...members];
                          next[index] = { ...member, role: event.target.value as MemberDraft['role'] };
                          setMembers(next);
                        }}
                      >
                        <option value="owner">owner</option>
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </td>
                    <td>
                      <button
                        className="small-button"
                        onClick={() => setMembers(members.filter((_, i) => i !== index))}
                      >
                        {t('remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="field-row">
              <input
                className="form-input"
                placeholder={t('subject')}
                value={memberSubject}
                onChange={(event) => setMemberSubject(event.target.value)}
              />
              <select value={memberRole} onChange={(event) => setMemberRole(event.target.value as MemberDraft['role'])}>
                <option value="owner">owner</option>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
              <button
                className="small-button"
                disabled={!memberSubject.trim()}
                onClick={() => {
                  setMembers([...members, { subject: memberSubject.trim(), role: memberRole }]);
                  setMemberSubject('');
                }}
              >
                {t('addMember')}
              </button>
            </div>
            <h4>{t('checkWaivers')}</h4>
            <table className="relation-list">
              <tbody>
                {groupRoles.map((mapping, index) => (
                  <tr key={mapping.group + index}>
                    <td>
                      <input
                        className="form-input"
                        value={mapping.group}
                        aria-label={t('subject')}
                        onChange={(event) => {
                          const next = [...groupRoles];
                          next[index] = { ...mapping, group: event.target.value };
                          setGroupRoles(next);
                        }}
                      />
                    </td>
                    <td>
                      <select
                        value={mapping.role}
                        onChange={(event) => {
                          const next = [...groupRoles];
                          next[index] = { ...mapping, role: event.target.value as GroupRoleDraft['role'] };
                          setGroupRoles(next);
                        }}
                      >
                        <option value="owner">owner</option>
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </td>
                    <td>
                      <button
                        className="small-button"
                        onClick={() => setGroupRoles(groupRoles.filter((_, i) => i !== index))}
                      >
                        {t('remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="field-row">
              <input
                className="form-input"
                placeholder="admins-group"
                value={groupRoleGroup}
                onChange={(event) => setGroupRoleGroup(event.target.value)}
              />
              <select value={groupRoleRole} onChange={(event) => setGroupRoleRole(event.target.value as GroupRoleDraft['role'])}>
                <option value="owner">owner</option>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
              <button
                className="small-button"
                disabled={!groupRoleGroup.trim()}
                onClick={() => {
                  setGroupRoles([...groupRoles, { group: groupRoleGroup.trim(), role: groupRoleRole }]);
                  setGroupRoleGroup('');
                }}
              >
                {t('addWaiver')}
              </button>
            </div>
            <div className="settings-actions">
              <button className="primary-button" onClick={() => void saveMembers()}>
                {t('save')}
              </button>
              <span className="muted">{membersStatus}</span>
            </div>
          </section>
        )}

        <section className="panel-card wide">
          <h3>{t('lifecycle')}</h3>
          <div className="settings-actions">
            <button onClick={onDuplicate}>{t('duplicateWorkspace')}</button>
            <button onClick={onArchive} disabled={model.status === 'archived'}>
              Archive workspace
            </button>
            <button className="danger-link" onClick={onDelete}>
              Delete workspace
            </button>
          </div>
          <p className="muted">
            Duplicating copies the whole model, domains, and artefacts. Archiving keeps the data but
            hides it from the default list. Deleting cannot be undone.
          </p>
        </section>
      </div>
    </div>
  );
}
