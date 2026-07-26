#!/usr/bin/env python3
import asyncio
import importlib.metadata
import json
import os
import socket
from contextlib import asynccontextmanager

import uvicorn
from starlette.applications import Starlette

from a2a.helpers.proto_helpers import new_task_from_user_message
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types import AgentCapabilities, AgentCard, AgentInterface, Part, TaskState
from a2a.utils import TransportProtocol


def reserve_port() -> int:
    requested = int(os.environ.get('A2A_INTEROP_PORT', '0'))
    if requested:
        return requested
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
        candidate.bind(('127.0.0.1', 0))
        return int(candidate.getsockname()[1])


class LivePythonExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        task = context.current_task
        if not task:
            task = new_task_from_user_message(context.message)
            task.id = context.task_id
            task.context_id = context.context_id
            await event_queue.enqueue_event(task)

        updater = TaskUpdater(event_queue, task.id, task.context_id)
        await updater.start_work()
        await asyncio.sleep(0.02)
        await updater.add_artifact(
            parts=[Part(text=f'python:{context.get_user_input()}', media_type='text/plain')],
            name='Official Python artifact',
            last_chunk=True,
        )
        await updater.complete()

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await updater.cancel()


async def main() -> None:
    port = reserve_port()
    base_url = f'http://127.0.0.1:{port}'
    card = AgentCard(
        name='Official Python live server',
        description='Loopback-only a2a-sdk live interoperability participant.',
        version='1.1.2',
        capabilities=AgentCapabilities(streaming=True, push_notifications=False),
        skills=[],
        default_input_modes=['text/plain'],
        default_output_modes=['text/plain'],
        supported_interfaces=[
            AgentInterface(
                protocol_binding=TransportProtocol.JSONRPC,
                protocol_version='1.0',
                url=f'{base_url}/a2a/jsonrpc',
            )
        ],
    )
    handler = DefaultRequestHandler(
        agent_executor=LivePythonExecutor(),
        task_store=InMemoryTaskStore(),
        agent_card=card,
    )
    @asynccontextmanager
    async def lifespan(_app: Starlette):
        try:
            yield
        finally:
            await handler.aclose()

    app = Starlette(
        routes=[
            *create_agent_card_routes(card),
            *create_jsonrpc_routes(handler, rpc_url='/a2a/jsonrpc'),
        ],
        lifespan=lifespan,
    )
    config = uvicorn.Config(
        app,
        host='127.0.0.1',
        port=port,
        log_level='warning',
        access_log=False,
    )
    server = uvicorn.Server(config)
    serve_task = asyncio.create_task(server.serve())
    while not server.started:
        if serve_task.done():
            await serve_task
            raise RuntimeError('Official Python server exited before readiness')
        await asyncio.sleep(0.01)
    print(
        json.dumps(
            {
                'type': 'ready',
                'participant': 'official-python-server',
                'sdk': 'a2a-sdk',
                'sdkVersion': importlib.metadata.version('a2a-sdk'),
                'protocolVersion': '1.0',
                'url': base_url,
            },
            separators=(',', ':'),
        ),
        flush=True,
    )
    await serve_task


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:  # noqa: BLE001
        print(str(error), flush=True)
        raise SystemExit(1) from error
