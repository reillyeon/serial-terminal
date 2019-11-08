/**
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Terminal } from 'xterm';
import 'xterm/dist/xterm.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration =
          await navigator.serviceWorker.register('/service-worker.js');
      console.log('SW registered: ', registration);
    } catch (registrationError) {
      console.log('SW registration failed: ', registrationError);
    }
  });
}

let connectButton: HTMLButtonElement;
let baudRateSelector: HTMLSelectElement;
let customBaudRateInput: HTMLInputElement;
let dataBitsSelector: HTMLSelectElement;
let paritySelector: HTMLSelectElement;
let stopBitsSelector: HTMLSelectElement;
let flowControlCheckbox: HTMLInputElement;
let echoCheckbox: HTMLInputElement;
let connected = false;
let portUnreadable: Promise<void> | undefined;
let portUnwritable: Promise<void> | undefined;
let streamController = new AbortController();

const term = new Terminal();
const termInputFromPort = new WritableStream({
  write(chunk) {
    term.writeUtf8(chunk);
  }
});
const termInputFromEcho = new WritableStream({
  write(chunk) {
    if (echoCheckbox.checked) {
      term.writeUtf8(chunk);
    }
  }
});
const [termOutputForPort, termOutputForEcho] = new ReadableStream({
  start(controller) {
    term.on('data', data => {
      controller.enqueue(data);
    });
  }
}).pipeThrough(new TextEncoderStream()).tee();

document.addEventListener('DOMContentLoaded', () => {
  term.open(<HTMLElement>document.getElementById('terminal'));

  connectButton = <HTMLButtonElement>document.getElementById('connect');
  connectButton.addEventListener('click', () => {
    if (connected) {
      streamController.abort();
    } else {
      requestNewPort();
    }
  });

  baudRateSelector = <HTMLSelectElement>document.getElementById('baudrate');
  baudRateSelector.addEventListener('input', () => {
    if (baudRateSelector.value == 'custom') {
      customBaudRateInput.hidden = false;
    } else {
      customBaudRateInput.hidden = true;
    }
  });

  customBaudRateInput =
      <HTMLInputElement>document.getElementById('custom_baudrate');
  dataBitsSelector = <HTMLSelectElement>document.getElementById('databits');
  paritySelector = <HTMLSelectElement>document.getElementById('parity');
  stopBitsSelector = <HTMLSelectElement>document.getElementById('stopbits');
  flowControlCheckbox = <HTMLInputElement>document.getElementById('rtscts');
  echoCheckbox = <HTMLInputElement>document.getElementById('echo');
});

async function requestNewPort() {
  try {
    const port = await navigator.serial.requestPort({});
    await connectToPort(port);
  } catch (e) {
    if (e.name != 'NotFoundError') {
      term.writeln(`<CONNECT ERROR: ${e.message}`);
    }
  }
}

async function connectToPort(port: SerialPort) {
  const options = {
    baudrate: getSelectedBaudRate(),
    databits: Number.parseInt(dataBitsSelector.value),
    parity: <ParityType>paritySelector.value,
    stopbits: Number.parseInt(stopBitsSelector.value),
    rtscts: flowControlCheckbox.checked
  };
  await port.open(options);

  connected = true;
  connectButton.textContent = 'Disconnect';
  baudRateSelector.disabled = true;
  customBaudRateInput.disabled = true;
  dataBitsSelector.disabled = true;
  paritySelector.disabled = true;
  stopBitsSelector.disabled = true;
  flowControlCheckbox.disabled = true;
  term.writeln('<CONNECTED>');

  processStreams(port);
}

function getSelectedBaudRate() {
  if (baudRateSelector.value == 'custom') {
    return Number.parseInt(customBaudRateInput.value);
  }
  return Number.parseInt(baudRateSelector.value);
}

async function processStreams(port: SerialPort) {
  streamController = new AbortController();
  portUnreadable = processReadableStream(port);
  portUnwritable = processWritableStream(port);

  // Read from the port until encountering an unrecoverable error or the user
  // clicks the disconnect button.
  await portUnreadable;

  // Clean up any remaining streams and close the port.
  streamController.abort();
  await portUnwritable;
  await port.close();

  connected = false;
  connectButton.textContent = 'Connect';
  baudRateSelector.disabled = false;
  customBaudRateInput.disabled = false;
  dataBitsSelector.disabled = false;
  paritySelector.disabled = false;
  stopBitsSelector.disabled = false;
  flowControlCheckbox.disabled = false;
  term.writeln('<DISCONNECTED>');
}

async function processWritableStream(port: SerialPort) {
  while (port && port.writable && !streamController.signal.aborted) {
    const localEchoController = new AbortController();
    const localEchoClosed = termOutputForEcho.pipeTo(
      termInputFromEcho,
      { signal: localEchoController.signal,
        preventClose: true,
        preventAbort: true,
        preventCancel: true });
    try {
      await termOutputForPort.pipeTo(
        port.writable,
        { signal: streamController.signal,
          preventClose: true,
          preventAbort: true,
          preventCancel: true});
    } catch (e) {
      if (e.name !== 'AbortError') {
        term.writeln(`<WRITE ERROR: ${e.message}>`);
      }
    } finally {
      localEchoController.abort();
      await localEchoClosed.catch(() => {});
    }
  }
}

async function processReadableStream(port: SerialPort) {
  while (port && port.readable && !streamController.signal.aborted) {
    try {
      await port.readable.pipeTo(
        termInputFromPort,
        { signal: streamController.signal,
          preventClose: true,
          preventAbort: true,
          preventCancel: true });
    } catch (e) {
      if (e.name !== 'AbortError') {
        term.writeln(`<READ ERROR: ${e.message}>`);
      }
    }
  }
}
