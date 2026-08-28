import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getSecretKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!raw) throw new Error('Clé serveur Supabase indisponible')
  const keys = JSON.parse(raw)
  return keys.default || Object.values(keys)[0]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Méthode non autorisée' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = getSecretKey()
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return response({ error: 'Session absente' }, 401)

    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const token = authHeader.replace(/^Bearer\s+/i, '')
    const { data: userData, error: userError } = await service.auth.getUser(token)
    if (userError || !userData.user) return response({ error: 'Session invalide' }, 401)
    const callerId = userData.user.id

    const { data: caller, error: callerError } = await service
      .from('profiles')
      .select('id,role,is_active')
      .eq('id', callerId)
      .single()

    if (callerError || !caller || !caller.is_active || !['administrateur','responsable'].includes(caller.role)) {
      return response({ error: 'Accès administrateur ou responsable requis' }, 403)
    }

    const body = await req.json()
    const action = body.action

    const assertCanManageTarget = async (targetId: string) => {
      const { data: target, error } = await service.from('profiles').select('id,role,is_active').eq('id', targetId).single()
      if (error || !target) throw new Error('Utilisateur introuvable')
      if (target.id === callerId) throw new Error('Cette opération est interdite sur votre propre compte')
      if (caller.role === 'responsable' && target.role === 'administrateur') {
        throw new Error('Un responsable ne peut pas gérer un administrateur')
      }
      return target
    }

    if (action === 'create') {
      const role = String(body.role || 'technicien')
      if (!['technicien','planificateur','responsable','administrateur'].includes(role)) {
        return response({ error: 'Rôle invalide' }, 400)
      }
      if (caller.role !== 'administrateur' && role === 'administrateur') {
        return response({ error: 'Seul un administrateur peut créer un administrateur' }, 403)
      }
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      if (!email || password.length < 8) return response({ error: 'E-mail ou mot de passe temporaire invalide' }, 400)

      const firstName = String(body.first_name || '').trim()
      const lastName = String(body.last_name || '').trim()
      const displayName = String(body.display_name || '').trim() || `${firstName} ${lastName}`.trim()

      const { data: created, error: createError } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          first_name: firstName,
          last_name: lastName,
          display_name: displayName,
        },
      })
      if (createError || !created.user) return response({ error: createError?.message || 'Création impossible' }, 400)

      const uid = created.user.id
      try {
        const { error: profileError } = await service.from('profiles').update({
          first_name: firstName,
          last_name: lastName,
          display_name: displayName,
          role,
          is_active: body.is_active !== false,
          has_global_scope: !!body.has_global_scope,
        }).eq('id', uid)
        if (profileError) throw profileError

        const groupIds = Array.isArray(body.group_ids) ? body.group_ids : []
        const primary = body.primary_group_id || null
        if (groupIds.length) {
          const rows = groupIds.map((group_id: string) => ({
            user_id: uid,
            group_id,
            is_primary: primary === group_id,
          }))
          const { error: groupsError } = await service.from('user_groups').insert(rows)
          if (groupsError) throw groupsError
        }
      } catch (e) {
        await service.auth.admin.deleteUser(uid)
        throw e
      }

      return response({ ok: true, user_id: uid })
    }

    if (action === 'update') {
      const targetId = String(body.user_id || '')
      const target = await assertCanManageTarget(targetId)
      const role = String(body.role || target.role)
      if (!['technicien','planificateur','responsable','administrateur'].includes(role)) return response({ error: 'Rôle invalide' }, 400)
      if (caller.role !== 'administrateur' && role === 'administrateur') return response({ error: 'Seul un administrateur peut attribuer ce rôle' }, 403)

      const { error: updateError } = await service.from('profiles').update({
        first_name: String(body.first_name || '').trim(),
        last_name: String(body.last_name || '').trim(),
        display_name: String(body.display_name || '').trim(),
        role,
        is_active: body.is_active !== false,
        has_global_scope: !!body.has_global_scope,
      }).eq('id', targetId)
      if (updateError) throw updateError

      await service.from('user_groups').delete().eq('user_id', targetId)
      const groupIds = Array.isArray(body.group_ids) ? body.group_ids : []
      const primary = body.primary_group_id || null
      if (groupIds.length) {
        const rows = groupIds.map((group_id: string) => ({
          user_id: targetId,
          group_id,
          is_primary: primary === group_id,
        }))
        const { error: groupsError } = await service.from('user_groups').insert(rows)
        if (groupsError) throw groupsError
      }
      return response({ ok: true })
    }

    if (action === 'set_active') {
      const targetId = String(body.user_id || '')
      await assertCanManageTarget(targetId)
      const { error } = await service.from('profiles').update({ is_active: !!body.is_active }).eq('id', targetId)
      if (error) throw error
      return response({ ok: true })
    }

    if (action === 'delete') {
      const targetId = String(body.user_id || '')
      const target = await assertCanManageTarget(targetId)

      if (target.role === 'administrateur') {
        const { count } = await service.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'administrateur').eq('is_active', true)
        if ((count || 0) <= 1) return response({ error: 'Impossible de supprimer le dernier administrateur actif' }, 409)
      }

      // Supprimer d'abord les participations des événements dont la personne est propriétaire.
      const { data: owned } = await service.from('events').select('id').eq('owner_id', targetId)
      const ownedIds = (owned || []).map((x: any) => x.id)
      if (ownedIds.length) {
        const { error: epOwnedError } = await service.from('event_participants').delete().in('event_id', ownedIds)
        if (epOwnedError) throw epOwnedError
      }

      // Retirer sa participation aux événements des autres.
      const { error: epError } = await service.from('event_participants').delete().eq('user_id', targetId)
      if (epError) throw epError

      // Les événements créés pour d'autres utilisateurs restent dans l'historique.
      const { error: createdByError } = await service.from('events').update({ created_by: callerId }).eq('created_by', targetId).neq('owner_id', targetId)
      if (createdByError) throw createdByError

      // Son propre calendrier a été archivé côté navigateur, on peut le purger.
      const { error: eventsError } = await service.from('events').delete().eq('owner_id', targetId)
      if (eventsError) throw eventsError

      await service.from('working_hours').delete().eq('user_id', targetId)
      await service.from('manager_group_access').delete().eq('user_id', targetId)
      await service.from('user_groups').delete().eq('user_id', targetId)

      const { error: deleteAuthError } = await service.auth.admin.deleteUser(targetId)
      if (deleteAuthError) throw deleteAuthError

      return response({ ok: true })
    }

    return response({ error: 'Action inconnue' }, 400)
  } catch (e) {
    console.error(e)
    return response({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
