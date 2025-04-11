---
runme:
  id: 01HV6WCDJJZYCVX89YE825JGSF
  version: v3
---

# AWS EC2 Cloud Renderers

AWS EC2 enables you to deploy cloud-native applications with top-tier security, performance, and reliability.

Discover how you can leverage Runme's robust Notebook Cloud Renderers to engage with your EC2 resources in ways you've never imagined before!

💡 **Important!** Be sure to run through the one-time guide [Getting started with Runme Noteboks for AWS](setup.md).

## AWS Profile

Set up the AWS Profile to ensure proper configuration. If not specified, the default profile will be used.

```sh {"id":"01J15VQSZ4Y96N3YJX889QR5W7","promptEnv":"yes","terminalRows":"2"}
export AWS_PROFILE="stateful"
echo "Using AWS Profile $AWS_PROFILE"
```

## List EC2 Instances

One of the fundamental tasks in working with EC2 is to list your instances, serving as the foundation for other operations such as managing instance states —starting, stopping, rebooting, or terminating them— or securely connecting via SSH.

Runme seamlessly integrates with your AWS EC2 resource URLs, mirroring your navigation in the AWS Console directly within your Notebook. This eliminates the need to open the console separately; instead, you can access its functionality right within your Notebook file!

Experience it firsthand by running the following URL to see Runme in action:

```sh {"id":"01HQRAF82SC4YPTNRGQ2TZ7DK2"}
https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#Instances
```

```sh {"background":"true","id":"01J1B86EN48NRRJHPNVVGJAMXY"}
echo "Connecting to instance via SSH..."
aws ec2-instance-connect ssh --instance-id i-0656ca72923a992b7 --region=us-east-1 --os-user=ec2-user
```

```sh {"background":"true","id":"01J1B85H6ZJ6P0VA9PW3D3Q3H7"}
echo "Connecting to instance via SSH..."
aws ec2-instance-connect ssh --instance-id i-015097a0646c45ea8 --region=us-east-1 --os-user=ubuntu
```

Isn't that cool? that's a **Runme cloud renderer** in Action!

When your AWS Credentials are correctly configured, you'll encounter a table resembling the one found in the AWS Console, showcasing essential details such as:

- Instance name
- State
- Type
- Availability Zone
- DNS Configuration
- Security groups
- Platform
- Launch time
- Actions (Secure SSH connection, access instance details)

You will also find useful links to the AWS Console like:

- Instances
- Launch instance
- Open EC2 Dashboard

## Display specific EC2 Instance

Just as with listing instances, if you execute an AWS Console link for specific instance details, you'll dive into a similar experience that offers a comprehensive breakdown of the instance's details.

💡 **Pro tip:** With the EC2 List instances actions column, you can effortlessly visualize instance details by clicking on the view instance details icon, eliminating the need to manually paste a specific instance console URL.

For a quick demo of visualizing a specific EC2 instance details, you can replace the instanceId placeholder with the instance you want to visualize:

```sh {"id":"01HYC3AWEMN7B6DK5MS36GK98D","terminalRows":"5"}
export EC2_INSTANCE_ID="i-015097a0646c45ea8"
echo "EC2_INSTANCE_ID set to $EC2_INSTANCE_ID"
```

```sh {"background":"false","id":"01HQRAK03KBKPSZ47CRDDFJWDV"}
https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#InstanceDetails:instanceId=$EC2_INSTANCE_ID
```

```sh {"background":"true","id":"01J1APZ2HW09ZNB41V8N2ZKQWH"}
echo "Connecting to instance via SSH..."
aws ec2-instance-connect ssh --instance-id i-015097a0646c45ea8 --os-user=ubuntu
```

## Connect to EC2 instance via SSH

You can leverage the AWS CLI to connect securely via SSH to a EC2 instance, run the following commands:

```sh {"id":"01HV6XT7E79H95RB7NSTX1GCN0","promptEnv":"yes","terminalRows":"5"}
export EC2_INSTANCE_ID=Enter a valid EC2 instance ID please
echo "Configured EC2 Instance is $EC2_INSTANCE_ID"
```

Now that you have the instance configured, run the following command to connect:

```sh {"background":"true","id":"01HQRAMMXGPYTFGQDMREZHNB37","terminalRows":"25"}
echo "Connecting to instance via SSH..."
aws ec2-instance-connect ssh --instance-id $EC2_INSTANCE_ID --os-user=ubuntu
```

### Feedback welcome!

Do you have feedback or new ideas ? what about more Runme Cloud renderers for AWS features ?
Feel free to [reach out to us](https://github.com/runmedev/runme?tab=readme-ov-file#feedback)
