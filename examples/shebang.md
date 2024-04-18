---
runme:
  id: 01HF7B0KJQ8625WYMCRVJADMQF
  version: v3
---

# Runme Language Support

By default Runme can run everything that is also installed on your machine.

Shebang is a versatile tool designed to execute scripts written in various scripting languages including Shell, Perl, Python, Ruby, Node.js, and [more](https://docs.runme.dev/configuration/shebang). Runme integrates Shebang to enable users to run the script of their choice directly from the Markdown file in their preferred programming language.

Let's learn how to use multiple programming languages to interact with your containers!

In this example we will write a simple script in different programming languages that lists your running containers.

💡 Before starting, ensure you have the following installed in your machine:

- Docker 🐳
- Ruby 💎 (for Ruby example)
- Node.js 🍦 (for Node.js example)

## Ensure docker is up and running

Run the following check, just to ensure you have Docker up and running

```sh {"id":"01HTZBCXFZ0V7P4AXE70CNSGPG","terminalRows":"3"}
#!/bin/bash

# Check if Docker is installed
if ! command -v docker &> /dev/null
then
    echo "Docker is not installed."
    exit
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null
then
    echo "Docker daemon is not running. ❌"
    exit
fi

echo "Docker is installed and running. ✅"

```

Ensure you have a list one container to list, if you don't have one, you can start a **nginx** container by running the following command:

```sh {"id":"01HTZBCXFZ0V7P4AXE70RXT9M1"}
docker rm -f my_runme_demo_container
docker run -d --name my_runme_demo_container -p 8080:80 nginx
```

## Ruby 💎

### Requirements

- Ensure you have Ruby installed
- Install docker-api and terminal-table gems

Ensure you have ruby installed at least running version >= 2.7.0 (required to have this demo working).
You can run the following command to check your ruby version:

```sh {"id":"01HTZBCXFZ0V7P4AXE79429E8J","name":"check-ruby-version","terminalRows":"2"}
ruby -v
```

Install required gems

```sh {"id":"01HTZBG5NYPFHDKP0BQTPDQSE3"}
gem install docker-api terminal-table
```

```rb {"id":"01HTZBCXFZ0V7P4AXE7CSQQ7ST"}
require 'docker-api'
require 'terminal-table'

def list_running_containers
  Docker.url = 'unix:///var/run/docker.sock'
  containers = Docker::Container.all(:all => false)

  if containers.any?
    table = Terminal::Table.new :headings => ['Container ID', 'Name', 'Image', 'Status'] do |t|
      containers.each do |container|
        t << [container.id[0..11], container.info['Names'][0], container.info['Image'], container.info['State']]
      end
    end
    puts "Running containers:"
    puts table
  else
    puts "No running containers found."
  end
end

list_running_containers

```

## Node.js 🍦

```sh {"background":"true","id":"01HTZBXZHJ1ARVB67SD6FQMXA7"}
npm i cli-table3 dockerode
```

```js {"id":"01HTZBCXFZ0V7P4AXE7D90XPDT"}
const Docker = require('dockerode');
const Table = require('cli-table3');

// Initialize Docker API
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

function listRunningContainers() {
  docker.listContainers({ all: false }, (err, containers) => {
    if (err) {
      console.error('Error fetching containers:', err);
      return;
    }

    if (containers.length > 0) {
      const table = new Table({
        head: ['Container ID', 'Name', 'Image', 'Status']
      });

      containers.forEach(containerInfo => {
        const containerId = containerInfo.Id.substr(0, 12);
        const containerName = containerInfo.Names[0];
        const containerImage = containerInfo.Image;
        const containerStatus = containerInfo.State;

        table.push([containerId, containerName, containerImage, containerStatus]);
      });

      console.log('Running containers:');
      console.log(table.toString());
    } else {
      console.log('No running containers found.');
    }
  });
}

listRunningContainers();

```
