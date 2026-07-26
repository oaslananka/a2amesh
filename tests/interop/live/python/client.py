#!/usr/bin/env python3
import asyncio
import importlib.metadata
import json
import sys
from uuid import uuid4

import httpx

from a2a.client import ClientConfig, create_client
from a2a.types import (
    CancelTaskRequest,
    GetTaskRequest,
    Message,
    Part,
    Role,
    SendMessageConfiguration,
    SendMessageRequest,
    TaskState,
)
from a2a.utils import TransportProtocol


def task_state_name(value: int) -> str:
    return TaskState.Name(value)


async def run_cancel(base_url: str) -> dict[str, object]:
    async with httpx.AsyncClient(timeout=20.0) as http_client:
        config = ClientConfig(
            streaming=False,
            polling=True,
            httpx_client=http_client,
            supported_protocol_bindings=[TransportProtocol.JSONRPC],
        )
        client = await create_client(base_url, client_config=config)
        try:
            message = Message(
                role=Role.ROLE_USER,
                message_id=f'python-live-{uuid4()}',
                parts=[Part(text='cancel from official python')],
            )
            request = SendMessageRequest(
                message=message,
                configuration=SendMessageConfiguration(return_immediately=True),
            )
            task_id = ''
            initial_state = ''
            async for response in client.send_message(request=request):
                if response.HasField('task'):
                    task_id = response.task.id
                    initial_state = task_state_name(response.task.status.state)
                    break
                if response.HasField('status_update'):
                    task_id = response.status_update.task_id
                    initial_state = task_state_name(response.status_update.status.state)
                    break
            if not task_id:
                raise RuntimeError('Official Python client did not receive a task id')

            retrieved = await client.get_task(request=GetTaskRequest(id=task_id))
            canceled = await client.cancel_task(request=CancelTaskRequest(id=task_id))
            return {
                'direction': 'official-python-client->a2amesh-server',
                'sdk': 'a2a-sdk',
                'sdkVersion': importlib.metadata.version('a2a-sdk'),
                'protocolVersion': '1.0',
                'taskId': task_id,
                'initialState': initial_state,
                'retrievedState': task_state_name(retrieved.status.state),
                'state': task_state_name(canceled.status.state),
            }
        finally:
            await client.close()


async def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    base_url = sys.argv[2] if len(sys.argv) > 2 else ''
    if command != 'cancel' or not base_url:
        print('Usage: client.py cancel <base-url>', file=sys.stderr)
        return 64
    result = await run_cancel(base_url)
    print(json.dumps(result, separators=(',', ':')), flush=True)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception as error:  # noqa: BLE001
        print(str(error), file=sys.stderr, flush=True)
        raise SystemExit(1) from error
