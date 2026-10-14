import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { sceneSchema } from '@roomsell/scene-core';
import { validateScene } from '@roomsell/geometry';
import { api, jsonBody } from '../../../../../lib/http-api';
import { membership, adminClient, databaseError } from '../../../../../lib/supabase-server';
import { uuid } from '../../../../../lib/account-schemas';
import { projectInputSchema } from '../../../../../lib/business-schemas';
import { projectDto } from '../../../../../lib/project-service';
import { ServiceError } from '../../../../../lib/editor-service';
type Context = { params: Promise<{ orgId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const orgId = uuid.parse((await params).orgId);
    const { client } = await membership(orgId);
    const result = await client
      .from('projects')
      .select('*')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .limit(500);
    databaseError(result.error);
    return (result.data || []).map(projectDto);
  });
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const orgId = uuid.parse((await params).orgId),
      body = projectInputSchema.parse(await jsonBody(request));
    const { client, user } = await membership(orgId, ['owner', 'admin', 'salesperson', 'designer']);
    if (body.customerId) {
      const customer = await client
        .from('customers')
        .select('id')
        .eq('organisation_id', orgId)
        .eq('id', body.customerId)
        .maybeSingle();
      databaseError(customer.error);
      if (!customer.data) throw new ServiceError(404, 'Customer not found in this organisation.');
    }
    const scene = sceneSchema.parse({
      schemaVersion: 2,
      id: randomUUID(),
      organisationId: orgId,
      version: 0,
      room: body.room,
      objects: [],
      groups: [],
    });
    if (validateScene(scene).length) throw new ServiceError(422, 'Room architecture is invalid.');
    const result = await adminClient().rpc('create_project', {
      p_org_id: orgId,
      p_actor_id: user.id,
      p_customer_id: body.customerId,
      p_name: body.name,
      p_budget_minor: body.budgetMinor,
      p_currency: body.currency,
      p_style: body.style,
      p_room_type: body.roomType,
      p_scene: scene,
    });
    databaseError(result.error);
    return projectDto(result.data.project);
  }, 201);
}
